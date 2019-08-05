const ppMap = {};

const graphql2server = "https://graphql2.fstk.io";

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
      window.EthKeyLibBrowser.DecryptEthereumKeyJson(
        passphrase,
        ethereumKeyJson
      )
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
  return (
    window.EthKeyLibBrowser.SignTransaction(privateKeyBuffer, txObj) || null
  );
}

function afterClickSubmitTransactionButton() {
  const endpoint = window.$("#endpoint").val();
  const id = window.$("#signin-id").val();
  const pw = window.$("#signin-pw").val();
  const passphrase = window.$("#ethk-pp").val();
  const mutationResp = window.$("#mutation-resp").val();

  if (
    [endpoint, id, pw, passphrase, mutationResp].every(
      content => content.length > 0
    )
  ) {
    // set UI (freeze or reset all UI)
    window.$("#endpoint").prop("readonly", true);
    window.$("#signin-id").prop("readonly", true);
    window.$("#signin-pw").prop("readonly", true);
    window.$("#ethk-pp").prop("readonly", true);
    window.$("#mutation-resp").prop("readonly", true);
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#txhash").val("Waiting for transaction");
    window.$("#address").val("Waiting for decryption");

    // signin
    const afterSigninPromise = window
      .axios({
        url: `/to/${endpoint}/signin`,
        baseURL: graphql2server,
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
      })
      .then(resp => {
        if (!resp.data.data.signIn) {
          // set UI (bad sign in info)
          window.$("#signin-id").addClass("bad-form");
          window.$("#signin-pw").addClass("bad-form");

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

      return window
        .axios({
          url: `/to/${infoObj.endpoint}/api`,
          baseURL: graphql2server,
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
        })
        .then(resp => {
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
        window.$("#address").val("Decrypting the wallet file (key file)...");

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
              window.$("#ethk-pp").addClass("bad-form");
              window.$("#address").val("Wrong passphrase");

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
          window.$("#address").val(infoObj.pp.checksumAddressString);
          window.$("#address").unbind("click");
          window.$("#address").on("click", () => {
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
        window.$("#txhash").val("Submitting the transaction...");

        const parsedMutationResp = parseMutationResp(mutationResp);

        if (!parsedMutationResp) {
          //set UI (bad mutation resp)
          window.$("#mutation-resp").addClass("bad-form");

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
          window.$("#mutation-resp").addClass("bad-form");

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

        return window
          .axios({
            url: `/to/${infoObj.endpoint}/api`,
            baseURL: graphql2server,
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
          })
          .then(resp => {
            if (!resp.data.data.submitTransaction) {
              // set UI (bad submitTransaction)
              window
                .$("#txhash")
                .val("The transaction is expired or duplicated on blockchain");
              window.$("#txhash").addClass("bad-form");

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
        window.$("#submit-transaction").html("Transaction Submitted");
        window.$("#txhash").val(infoObj.latestTxHash);
        window.$("#check-txhash").prop("disabled", false);
        window.$("#check-txhash").unbind("click");
        window.$("#check-txhash").on("click", () => {
          window.open(
            infoObj.endpoint.replace("api", "explorer") +
              "/tx/" +
              infoObj.latestTxHash,
            "_blank"
          );
        });
      }

      // set UI (defreeze UI)
      window.$("#endpoint").prop("readonly", false);
      window.$("#signin-id").prop("readonly", false);
      window.$("#signin-pw").prop("readonly", false);
      window.$("#ethk-pp").prop("readonly", false);
      window.$("#mutation-resp").prop("readonly", false);
    });
  }
}

function loadLocalStorage() {
  return JSON.parse(window.localStorage.getItem("fstnetwork-workshop") || "{}");
}

function setLocalStorage(obj) {
  return window.localStorage.setItem(
    "fstnetwork-workshop",
    JSON.stringify(obj)
  );
}

function reloadHashTable() {
  const obj = loadLocalStorage();

  if (!obj.hashTable) {
    obj.hashTable = [];
  }

  // render hash table body
  const tmpTbody = obj.hashTable.map((rowObj, i) => {
    const rowHtml = `
        <tr id="row-${rowObj.hash}">
          <td>${rowObj.original_content}</td>
          <td>${rowObj.salt === "" ? "(empty)" : rowObj.salt}</td>
          <td>${rowObj.hash}</td>
          <td>${rowObj.de_identified_entry}</td>
          <td><button style="margin-bottom: 0px;" id="delete-${
            rowObj.hash
          }-row">delete</button></td>
        </tr>
    `;

    return [rowObj, rowHtml, i];
  });

  if (tmpTbody.length === 0) {
    return window
      .$("#hash-table-body")
      .html(`<tr><td>(table is empty)</td></tr>`);
  }

  window
    .$("#hash-table-body")
    .html(tmpTbody.map(([_1, rowHtml, _2]) => rowHtml).join(""));

  // bind events
  tmpTbody.forEach(([rowObj, _1, i]) => {
    window.$(`#delete-${rowObj.hash}-row`).unbind("click");
    window.$(`#delete-${rowObj.hash}-row`).on("click", () => {
      window.$(`#delete-${rowObj.hash}-row`).unbind("click");
      removeRowFromHashTable(i);
    });
  });
}

function addRowToHashTable(rowObj) {
  if (!rowObj) return;

  const obj = loadLocalStorage();

  if (!obj.hashTable) {
    obj.hashTable = [];
  }

  if (obj.hashTable.some(_rowObj => _rowObj.hash === rowObj.hash)) {
    return "duplicated";
  }

  obj.hashTable.push(rowObj);

  setLocalStorage(obj);

  reloadHashTable();
}

function removeRowFromHashTable(index) {
  if (index < 0) return;

  const obj = loadLocalStorage();

  if (!obj.hashTable) return;
  if (obj.hashTable.length === 0) return;

  obj.hashTable.splice(index, 1);

  setLocalStorage(obj);

  reloadHashTable();
}

window.$(function() {
  // page api tx tool
  // form check
  window.Bacon.combineAsArray(
    window
      .$("#endpoint")
      .asEventStream("input")
      .map(e => {
        window.$(e.target).removeClass("bad-form");
        return window.$(e.target).val();
      })
      .toProperty(""),
    window
      .$("#signin-id")
      .asEventStream("input")
      .map(e => {
        window.$(e.target).removeClass("bad-form");
        window.$("#signin-pw").removeClass("bad-form");
        return window.$(e.target).val();
      })
      .toProperty(""),
    window
      .$("#signin-pw")
      .asEventStream("input")
      .map(e => {
        window.$(e.target).removeClass("bad-form");
        window.$("#signin-id").removeClass("bad-form");
        return window.$(e.target).val();
      })
      .toProperty(""),
    window
      .$("#ethk-pp")
      .asEventStream("input")
      .map(e => {
        window.$(e.target).removeClass("bad-form");
        window.$("#address").val("Waiting for decryption");
        return window.$(e.target).val();
      })
      .toProperty(""),
    window
      .$("#mutation-resp")
      .asEventStream("input")
      .map(e => {
        window.$(e.target).removeClass("bad-form");
        return window.$(e.target).val();
      })
      .toProperty("")
  ).onValue(arr => {
    window.$("#address").val("Waiting for decryption");
    window.$("#txhash").val("Waiting for transaction");
    window.$("#txhash").removeClass("bad-form");
    window.$("#submit-transaction").html("6. Decrypt Key and Submit Transaction");
    if (arr.every(content => content.length > 0)) {
      window.$("#mutation-resp").scrollTop(0);
      window.$("#submit-transaction").prop("disabled", false);
    } else {
      window.$("#submit-transaction").prop("disabled", true);
    }
  });

  window
    .$("#submit-transaction")
    .on("click", afterClickSubmitTransactionButton);

  //
  // page hashing tool

  Bacon.combineAsArray(
    window
      .$("#hash-content")
      .asEventStream("input")
      .map(e => {
        return window.$(e.target).val();
      })
      .toProperty(""),
    window
      .$("#hash-salt")
      .asEventStream("input")
      .map(e => {
        return window.$(e.target).val() || "";
      })
      .toProperty("")
  ).onValue(([content, salt]) => {
    if (content + salt === "") {
      window.$("#hash-save").prop("disabled", true);
      window.$("#hash-result").val("");
      return window.$("#hash-result-20bytes").val("");
    }

    const tmpSalt = salt === "" ? "" : window.keccak256(salt);
    window.$("#hash-save").prop("disabled", false);
    window.$("#hash-result").val(window.keccak256(content + tmpSalt));
    window.$("#hash-result-20bytes").val(
      window
        .$("#hash-result")
        .val()
        .slice(0, 40)
    );
  });

  reloadHashTable();

  window.$("#hash-save").on("click", () => {
    addRowToHashTable({
      hash: window.$("#hash-result").val(),
      original_content: window.$("#hash-content").val(),
      salt: window.$("#hash-salt").val(),
      de_identified_entry: window.$("#hash-result-20bytes").val()
    });
  });

  //
  // goto page api tx tool first
  $("#go-to-page-api-tx-tool").on("click", () => {
    $(".page-hashing-tool").addClass("cloak");
    $(".page-api-tx-tool").removeClass("cloak");
  });

  $("#go-to-page-hashing-tool").on("click", () => {
    $(".page-api-tx-tool").addClass("cloak");
    $(".page-hashing-tool").removeClass("cloak");
  });

  $("#go-to-page-api-tx-tool").click();
});
