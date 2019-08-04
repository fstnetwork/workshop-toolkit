function resetForm() {
  $("#endpoint").val("");
  $("#signin-id").val("");
  $("#signin-pw").val("");
  $("#ethk-pp").val("");
  $("#mutation-resp").val("");
  $("#txhash").val("");
}

function decryptEthereumKeyPromise(passphrase, ethereumKeyJson) {
  if (window.Worker) {
    const theWorker = new Worker("./lib/eth-key-lib-worker.js");
    theWorker.postMessage({ passphrase, ethereumKeyJson });
    return new Promise(res => {
      theWorker.onmessage = function(result) {
        theWorker.terminate();
        const tmpObj = JSON.parse(result.data);
        tmpObj.privateKeyBuffer = window.buffer.Buffer.from(
          tmpObj.privateKeyBuffer
        );
        res(tmpObj);
      };
    }).then(result => {
      if (result) {
        return result;
      }
      return null;
    });
  } else {
    return Promise.resolve(
      EthKeyLibBrowser.DecryptEthereumKeyJson(passphrase, ethereumKeyJson)
    ).then(result => {
      if (result) {
        return result;
      }
      return null;
    });
  }
}

function decryptingUI() {
  $("#address").val("processing wallet file (key file)...");
  $("#txhash").val("");
  $("#submit-transaction").prop("disabled", true);
  $("#check-txhash").prop("disabled", true);
}

function decryptingUIDone(infoObj) {
  $("#address").val(infoObj.pp.checksumAddressString);
  $("#address").unbind("click");
  $("#address").on("click", () => {
    window.open(
      infoObj.endpoint.replace("api", "explorer") +
        "/address/" +
        infoObj.pp.checksumAddressString,
      "_blank"
    );
  });
}

function mutationRespUpdatedAndKeyUpdatedUI() {
  $("#submit-transaction").prop("disabled", false);
  $("#check-txhash").prop("disabled", true);
}

function submittingTransactionUI() {
  $("#submit-transaction").prop("disabled", true);
  $("#check-txhash").prop("disabled", true);
  $("#txhash").val("Submitting transaction...");
}

function submittingTransactionUIDone(infoObj) {
  $("#txhash").val(infoObj.latestTxHash);
  $("#check-txhash").prop("disabled", false);
  $("#check-txhash").unbind("click");
  $("#check-txhash").on("click", () => {
    window.open(
      infoObj.endpoint.replace("api", "explorer") +
        "/tx/" +
        infoObj.latestTxHash,
      "_blank"
    );
  });
}

function parseMutationResp(content) {
  let resp = {};

  try {
    resp = JSON.parse(content);
  } catch (err) {
    console.error(err);
    return null;
  }

  return {
    transaction: jsonpath.query(resp, "$.data.*.transaction")[0],
    submitToken: jsonpath.query(resp, "$.data.*.submitToken")[0]
  };
}

function signTransaction(privateKeyBuffer, txObj) {
  return EthKeyLibBrowser.SignTransaction(privateKeyBuffer, txObj);
}

$(function() {
  resetForm();

  const endpointStream = $("#endpoint")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });

  const signinIdStream = $("#signin-id")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });

  const signinPwStream = $("#signin-pw")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });

  const ethkppStream = $("#ethk-pp")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });

  const mutationRespStream = $("#mutation-resp")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    })
    .filter(content => parseMutationResp(content) !== null)
    .map(content => parseMutationResp(content));

  const submitTransactionButtonStream = $("#submit-transaction").asEventStream(
    "click"
  );

  const signStream = Bacon.combineAsArray(
    endpointStream,
    signinIdStream,
    signinPwStream
  );

  const accessTokenStream = signStream
    .filter(arr => {
      if (arr.every(content => content.length > 0)) return true;
      else return false;
    })
    .flatMap(arr => {
      const endpoint = arr[0];
      const id = arr[1];
      const pw = arr[2];

      return Bacon.fromPromise(
        axios({
          url: "/signin",
          baseURL: endpoint,
          method: "post",
          withCredentials: false,
          data: {
            query: `
        mutation signIn {
          signIn(input: { id: "${id}", password: "${pw}" }) {
            access_token
          }
        }
        `
          }
        }).then(resp => {
          const access_token = resp.data.data.signIn.access_token;
          return {
            endpoint,
            id,
            pw,
            access_token,
            ethereumKey: ""
          };
        })
      );
    })
    .filter(infoObj => infoObj.access_token.length > 0);

  const ethereumKeyStream = accessTokenStream
    .flatMap(infoObj => {
      return Bacon.fromPromise(
        axios({
          url: "/api",
          baseURL: infoObj.endpoint,
          method: "post",
          withCredentials: false,
          headers: {
            Authorization: `Bearer ${infoObj.access_token}`
          },
          data: {
            query: `
          query ethereumKey {
            ethereumKey {
              version
              address
              crypto
            }
          }
        `
          }
        }).then(resp => {
          infoObj.ethereumKey = resp.data.data.ethereumKey;
          return infoObj;
        })
      );
    })
    .filter(infoObj => infoObj.ethereumKey !== null);

  const readyToMakeTransactionStream = Bacon.combineAsArray(
    ethkppStream.filter(content => content.length > 0),
    ethereumKeyStream
  )
    .flatMap(arr => {
      const passphrase = arr[0];
      const infoObj = arr[1];
      infoObj.passphrase = passphrase;

      decryptingUI();

      return Bacon.fromPromise(
        decryptEthereumKeyPromise(infoObj.passphrase, infoObj.ethereumKey).then(
          pp => {
            infoObj.pp = pp;
            return infoObj;
          }
        )
      );
    })
    .filter(infoObj => infoObj.pp !== null)
    .map(infoObj => {
      decryptingUIDone(infoObj);
      return infoObj;
    });

  // sign and submit transaction after sign-in/ethkey/mutationresp are ready
  const transactionHashStream = Bacon.combineAsArray(
    Bacon.combineAsArray(mutationRespStream, readyToMakeTransactionStream).map(
      arr => {
        mutationRespUpdatedAndKeyUpdatedUI();
        return arr;
      }
    ),
    submitTransactionButtonStream
  )
    .map(arr => {
      const parsedMutationResp = arr[0][0];
      const infoObj = arr[0][1];

      return {
        signedTx: signTransaction(
          infoObj.pp.privateKeyBuffer,
          parsedMutationResp.transaction
        ),
        submitToken: parsedMutationResp.submitToken,
        ...infoObj
      };
    })
    .flatMap(infoObj => {
      return Bacon.fromPromise(
        axios({
          url: "/api",
          baseURL: infoObj.endpoint,
          method: "post",
          withCredentials: false,
          headers: {
            Authorization: `Bearer ${infoObj.access_token}`
          },
          data: {
            query: `
            mutation submitTransaction {
              submitTransaction(input: { signedTx: "${
                infoObj.signedTx
              }", submitToken: "${infoObj.submitToken}" }) {
                transactionHash
              }
            }
            `
          }
        }).then(resp => {
          infoObj.latestTxHash =
            resp.data.data.submitTransaction.transactionHash;
          return infoObj;
        })
      );
    });

  transactionHashStream.onValue(infoObj => {
    submittingTransactionUIDone(infoObj);
    console.log(infoObj);
  });
});
