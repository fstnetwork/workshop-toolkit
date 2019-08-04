const ppMap = {};

function decryptEthereumKeyPromise(passphrase, ethereumKeyJson) {
  if (window.Worker) {
    const theWorker = new Worker("./lib/eth-key-lib-worker.js");
    theWorker.postMessage({ passphrase, ethereumKeyJson });
    return new Promise(res => {
      theWorker.onmessage = function(result) {
        theWorker.terminate();

        const tmpObj = JSON.parse(result.data);
        if (tmpObj.wrong === "passphrase") {
          return res(null);
        }

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
  return EthKeyLibBrowser.SignTransaction(privateKeyBuffer, txObj) || null;
}

function afterClickSubmitTransactionButton() {
  const endpoint = $("#endpoint").val();
  const id = $("#signin-id").val();
  const pw = $("#signin-pw").val();
  const passphrase = $("#ethk-pp").val();
  const mutationResp = $("#mutation-resp").val();

  if (
    [endpoint, id, pw, passphrase, mutationResp].every(
      content => content.length > 0
    )
  ) {
    // set UI (freeze or reset all UI)
    $("#endpoint").prop("readonly", true);
    $("#signin-id").prop("readonly", true);
    $("#signin-pw").prop("readonly", true);
    $("#ethk-pp").prop("readonly", true);
    $("#mutation-resp").prop("readonly", true);
    $("#submit-transaction").prop("disabled", true);
    $("#check-txhash").prop("disabled", true);
    $("#txhash").val("");
    $("#address").val("");

    // signin
    const afterSigninPromise = axios({
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
      if (!resp.data.data.signIn) {
        console.log("fuick!!!");
        // set UI (bad sign in info)
        $("#signin-id").addClass("bad-form");
        $("#signin-pw").addClass("bad-form");

        return null;
      }

      const access_token = resp.data.data.signIn.access_token;
      return {
        endpoint,
        id,
        pw,
        passphrase,
        access_token
      };
    });

    // get ethereumKey
    const afterGetEthereumKeyPromise = afterSigninPromise.then(infoObj => {
      if (!infoObj) {
        return null;
      }

      return axios({
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
        if (!resp.data.data.ethereumKey) {
          return null;
        }

        infoObj.ethereumKey = resp.data.data.ethereumKey;
        return infoObj;
      });
    });

    // decrypt ethereumKey
    const afterKeyDecryptionPromise = afterGetEthereumKeyPromise
      .then(infoObj => {
        if (!infoObj) {
          return null;
        }

        // set UI (decrypting ethereumKey)
        $("#address").val("Decrypting wallet file (key file)...");

        return Promise.resolve(true)
          .then(_ => {
            if (
              ppMap[
                `${[
                  infoObj.endpoint,
                  infoObj.id,
                  infoObj.pw,
                  infoObj.passphrase
                ].join("-")}`
              ] !== undefined
            ) {
              return ppMap[
                `${[
                  infoObj.endpoint,
                  infoObj.id,
                  infoObj.pw,
                  infoObj.passphrase
                ].join("-")}`
              ];
            } else {
              return decryptEthereumKeyPromise(
                infoObj.passphrase,
                infoObj.ethereumKey
              );
            }
          })
          .then(pp => {
            if (!pp) {
              // set UI (bad passphrase)
              $("#ethk-pp").addClass("bad-form");
              $("#address").val("Wrong passphrase");

              return null;
            }

            infoObj.pp = pp;
            return infoObj;
          });
      })
      .then(infoObj => {
        if (infoObj) {
          ppMap[
            `${[
              infoObj.endpoint,
              infoObj.id,
              infoObj.pw,
              infoObj.passphrase
            ].join("-")}`
          ] = infoObj.pp;

          // set UI (decrypt ethereumKey good)
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

          return infoObj;
        }

        return null;
      });

    // parse mutation resp and sign the transaction
    const afterSignTransactionPromise = afterKeyDecryptionPromise.then(
      infoObj => {
        if (!infoObj) {
          return null;
        }

        // set UI (submitting transaction)
        $("#txhash").val("Submitting transaction...");

        const parsedMutationResp = parseMutationResp(mutationResp);

        if (!parsedMutationResp) {
          //set UI (bad mutation resp)
          $("#mutation-resp").addClass("bad-form");

          return null;
        }

        const submitTransactionObj = {
          signedTx: signTransaction(
            infoObj.pp.privateKeyBuffer,
            parsedMutationResp.transaction
          ),
          submitToken: parsedMutationResp.submitToken
        };

        if (!submitTransactionObj.signedTx) {
          //set UI (bad mutation resp)
          $("#mutation-resp").addClass("bad-form");

          return null;
        }

        return {
          ...submitTransactionObj,
          ...infoObj
        };
      }
    );

    //submit transaction
    const afterSubmitTransactionPromise = afterSignTransactionPromise.then(
      infoObj => {
        if (!infoObj) {
          return null;
        }

        return axios({
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
          if (!resp.data.data.submitTransaction) {
            // set UI (bad submitTransaction)
            $("#txhash").val(
              "The transaction is expired or duplicated on blockchain"
            );
            $("#txhash").addClass("bad-form");

            return null;
          }

          infoObj.latestTxHash =
            resp.data.data.submitTransaction.transactionHash;
          return infoObj;
        });
      }
    );

    // set UI (submitting transaction good or all bad)
    afterSubmitTransactionPromise.then(infoObj => {
      if (infoObj) {
        $("#submit-transaction").html("Transaction Submitted");
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

      // set UI (defreeze UI)
      $("#endpoint").prop("readonly", false);
      $("#signin-id").prop("readonly", false);
      $("#signin-pw").prop("readonly", false);
      $("#ethk-pp").prop("readonly", false);
      $("#mutation-resp").prop("readonly", false);
    });
  }
}

$(function() {
  // form check
  Bacon.combineAsArray(
    $("#endpoint")
      .asEventStream("input")
      .map(e => {
        $(e.target).removeClass("bad-form");
        return $(e.target).val();
      })
      .toProperty(""),
    $("#signin-id")
      .asEventStream("input")
      .map(e => {
        $(e.target).removeClass("bad-form");
        return $(e.target).val();
      })
      .toProperty(""),
    $("#signin-pw")
      .asEventStream("input")
      .map(e => {
        $(e.target).removeClass("bad-form");
        return $(e.target).val();
      })
      .toProperty(""),
    $("#ethk-pp")
      .asEventStream("input")
      .map(e => {
        $(e.target).removeClass("bad-form");
        $("#address").val("");
        return $(e.target).val();
      })
      .toProperty(""),
    $("#mutation-resp")
      .asEventStream("input")
      .map(e => {
        $(e.target).removeClass("bad-form");
        return $(e.target).val();
      })
      .toProperty("")
  ).onValue(arr => {
    if (arr.every(content => content.length > 0)) {
      $("#txhash").val("");
      $("#txhash").removeClass("bad-form");
      $("#submit-transaction").html("Decrypt Key and Submit Transaction");
      $("#submit-transaction").prop("disabled", false);
    } else {
      $("#txhash").val("");
      $("#txhash").removeClass("bad-form");
      $("#submit-transaction").html("Decrypt Key and Submit Transaction");
      $("#submit-transaction").prop("disabled", true);
    }
  });

  $("#submit-transaction").on("click", afterClickSubmitTransactionButton);
});
