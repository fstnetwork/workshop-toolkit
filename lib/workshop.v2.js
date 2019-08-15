const ppMap = {};

const graphql2server = "https://graphql2.fstk.io";

let globalEndpointExplorer = "";

let globalBus = null;

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

  const transaction = jsonpath.query(resp, "$.data.*.transaction")[0];
  const submitToken = jsonpath.query(resp, "$.data.*.submitToken")[0];

  if (!transaction || !submitToken) {
    return "not-tx-mutation";
  }

  return {
    transaction,
    submitToken
  };
}

function signTransaction(privateKeyBuffer, txObj) {
  return (
    window.EthKeyLibBrowser.SignTransaction(privateKeyBuffer, txObj) || null
  );
}

function getAuthorizationHeaderUI() {
  const endpoint = window.$("#endpoint").val();
  const id = window.$("#signin-id").val();
  const pw = window.$("#signin-pw").val();

  if ([endpoint, id, pw].every(content => content.length > 0)) {
    window
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
        if (!resp.data.data) {
          // set UI (bad endpoint info)
          window.$("#endpoint").addClass("bad-form");

          return null;
        }
        if (!resp.data.data.signIn) {
          // set UI (bad sign in info)
          window.$("#signin-id").addClass("bad-form");
          window.$("#signin-pw").addClass("bad-form");
          window.$("#authorization-header").val("Wrong Sign-In info");

          return null;
        }

        const access_token = resp.data.data.signIn.access_token;

        window.$("#authorization-header").attr("data", access_token);
        window
          .$("#authorization-header")
          .val(
            JSON.stringify({ Authorization: `Bearer ${access_token}` }, null, 2)
          );

        globalBus.push("COND_AUTHED");
      });
  }
}

function getAddressUI() {
  const endpoint = window.$("#endpoint").val();
  const id = window.$("#signin-id").val();
  const pw = window.$("#signin-pw").val();
  const passphrase = window.$("#ethk-pp").val();
  const access_token = window.$("#authorization-header").attr("data") || "";

  if (
    [endpoint, id, pw, passphrase, access_token].every(
      content => content.length > 0
    )
  ) {
    window
      .axios({
        url: `/to/${endpoint}/api`,
        baseURL: graphql2server,
        method: "post",
        withCredentials: false,
        headers: {
          Authorization: `Bearer ${access_token}`
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

        window.$("#address").attr("data", resp.data.data.ethereumKey);

        return resp.data.data.ethereumKey;
      })
      .then(ethereumKey => {
        if (!ethereumKey) {
          return null;
        }

        // set UI (decrypting ethereumKey)
        window.$("#address").val("Decrypting the wallet file (key file)...");

        return Promise.resolve(true)
          .then(_ => {
            if (
              ppMap[`${[endpoint, id, pw, passphrase].join("-")}`] !== undefined
            ) {
              return ppMap[`${[endpoint, id, pw, passphrase].join("-")}`];
            } else {
              return decryptEthereumKeyPromise(passphrase, ethereumKey);
            }
          })
          .then(pp => {
            if (!pp) {
              // set UI (bad passphrase)
              window.$("#ethk-pp").addClass("bad-form");
              window.$("#address").val("Wrong passphrase");

              return null;
            }

            return pp;
          });
      })
      .then(pp => {
        if (pp) {
          ppMap[`${[endpoint, id, pw, passphrase].join("-")}`] = pp;

          // set UI (decrypt ethereumKey good)
          window.$("#ethk-pp").removeClass("bad-form");
          window.$("#address").val(pp.checksumAddressString);
          window.$("#address").unbind("click");
          window.$("#address").on("click", () => {
            window.open(
              endpoint.replace("api", "explorer") +
                "/address/" +
                pp.checksumAddressString,
              "_blank"
            );
          });

          globalBus.push("COND_KEY_DECRYPT");
        }
      });
  }
}

function getMutationRespUI() {
  const endpoint = window.$("#endpoint").val();
  const id = window.$("#signin-id").val();
  const pw = window.$("#signin-pw").val();
  const access_token = window.$("#authorization-header").attr("data") || "";
  const mutationReq = window.$("#mutation-req").val();

  if ([endpoint, id, pw, access_token].every(content => content.length > 0)) {
    window
      .axios({
        url: `/to/${endpoint}/api`,
        baseURL: graphql2server,
        method: "post",
        withCredentials: false,
        headers: {
          Authorization: `Bearer ${access_token}`
        },
        data: {
          query: mutationReq
        }
      })
      .then(resp => {
        if (!resp.data.data || !resp.data.data) {
          window.$("#submit-transaction").prop("disabled", true);
          window.$("#mutation-resp").addClass("bad-form");
          window.$("#mutation-resp").val("Server Error...");
          return null;
        }

        const parsedMutationResp = parseMutationResp(JSON.stringify(resp.data));

        if (parsedMutationResp === "not-tx-mutation") {
          window.$("#submit-transaction").prop("disabled", true);
          window.$("#mutation-resp").val(JSON.stringify(resp.data, null, 2));
          window.$("#mutation-resp").attr("data", "");
          return null;
        }

        if (!parsedMutationResp) {
          window.$("#submit-transaction").prop("disabled", true);
          window.$("#mutation-resp").addClass("bad-form");
          window.$("#mutation-resp").val(`Response malformed: ${resp.data}`);
          return null;
        }

        window.$("#mutation-resp").val(JSON.stringify(resp.data, null, 2));
        window
          .$("#mutation-resp")
          .attr("data", JSON.stringify(parsedMutationResp));

        globalBus.push("COND_MUT_RESP");
      })
      .catch(error => {
        window.$("#submit-transaction").prop("disabled", true);
        window.$("#mutation-resp").addClass("bad-form");

        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          window
            .$("#mutation-resp")
            .val(JSON.stringify(error.response, null, 2));
          console.error(error.response.data);
          console.error(error.response.status);
          console.error(error.response.headers);
        } else if (error.request) {
          // The request was made but no response was received
          // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
          // http.ClientRequest in node.js
          console.error(error.request);
        } else {
          // Something happened in setting up the request that triggered an Error
          console.error("Error", error.message);
        }

        console.error("Axios Error", error.config);
      });
  }
}

function afterClickSubmitTransactionButton() {
  const endpoint = window.$("#endpoint").val();
  const id = window.$("#signin-id").val();
  const pw = window.$("#signin-pw").val();
  const passphrase = window.$("#ethk-pp").val();
  const mutationReq = window.$("#mutation-req").val();
  const mutationResp = window.$("#mutation-resp").val();
  const access_token = window.$("#authorization-header").attr("data") || "";
  const _parsedMutationResp = window.$("#mutation-resp").attr("data") || "";

  if (
    [
      endpoint,
      id,
      pw,
      passphrase,
      mutationReq,
      mutationResp,
      access_token,
      _parsedMutationResp
    ].every(content => content.length > 0)
  ) {
    // set UI (freeze or reset all UI)
    window.$("#endpoint").prop("readonly", true);
    window.$("#signin-id").prop("readonly", true);
    window.$("#signin-pw").prop("readonly", true);
    window.$("#ethk-pp").prop("readonly", true);
    window.$("#mutation-req").prop("readonly", true);
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);

    // set UI (submitting transaction)
    window.$("#txhash").val("Submitting the transaction...");

    let parsedMutationResp = "";

    try {
      parsedMutationResp = JSON.parse(_parsedMutationResp);
    } catch (err) {
      console.error(err);
      return null;
    }

    const pp = ppMap[`${[endpoint, id, pw, passphrase].join("-")}`];

    const signedTx = signTransaction(
      pp.privateKeyBuffer,
      parsedMutationResp.transaction
    );

    const submitToken = parsedMutationResp.submitToken;

    window
      .axios({
        url: `/to/${endpoint}/api`,
        baseURL: graphql2server,
        method: "post",
        withCredentials: false,
        headers: {
          Authorization: `Bearer ${access_token}`
        },
        data: {
          query: `
            mutation submitTransaction {
              submitTransaction(input: { signedTx: "${signedTx}", submitToken: "${submitToken}" }) {
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
            .val("The transaction is expired or duplicated on data network");
          window.$("#txhash").addClass("bad-form");

          return null;
        }

        const latestTxHash = resp.data.data.submitTransaction.transactionHash;

        // set UI (submitting transaction good or all bad)
        window.$("#submit-transaction").html("Transaction Submitted");
        window.$("#txhash").val(latestTxHash);
        window.$("#check-txhash").prop("disabled", false);
        window.$("#check-txhash").unbind("click");
        window.$("#check-txhash").on("click", () => {
          window.open(
            endpoint.replace("api", "explorer") + "/tx/" + latestTxHash,
            "_blank"
          );
        });

        // set UI (defreeze UI)
        window.$("#endpoint").prop("readonly", false);
        window.$("#signin-id").prop("readonly", false);
        window.$("#signin-pw").prop("readonly", false);
        window.$("#ethk-pp").prop("readonly", false);
        window.$("#mutation-req").prop("readonly", false);
      })
      .catch(error => {
        // set UI (bad submitTransaction)
        window.$("#txhash").addClass("bad-form");
        window.$("#mutation-resp").addClass("bad-form");

        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          window
            .$("#mutation-resp")
            .val(JSON.stringify(error.response, null, 2));
          console.error(error.response.data);
          console.error(error.response.status);
          console.error(error.response.headers);
        } else if (error.request) {
          // The request was made but no response was received
          // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
          // http.ClientRequest in node.js
          console.error(error.request);
        } else {
          // Something happened in setting up the request that triggered an Error
          console.error("Error", error.message);
        }

        console.error("Axios Error", error.config);
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
    let de_identified_entry_link = `${rowObj.de_identified_entry}`;

    if (globalEndpointExplorer !== "") {
      de_identified_entry_link = `<a style="text-decoration-line: underline;" href="${globalEndpointExplorer}/address/0x${
        rowObj.de_identified_entry
      }" target="_blank">${rowObj.de_identified_entry}</a>`;
    }

    const rowHtml = `
        <tr id="row-${rowObj.hash}">
          <td>${rowObj.original_content}</td>
          <td>${rowObj.salt === "" ? "(empty)" : rowObj.salt}</td>
          <td>${rowObj.hash}</td>
          <td>${de_identified_entry_link}</td>
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
  // bus
  globalBus = new window.Bacon.Bus();

  //
  // page api tx tool

  // form check
  const endpointChangeStream = window
    .$("#endpoint")
    .asEventStream("change")
    .map(e => {
      window.$(e.target).removeClass("bad-form");
      window.$(e.target).val(
        window
          .$(e.target)
          .val()
          .replace("fst.network/api", "fst.network")
          .replace("fstk.io/api", "fstk.io")
          .replace("fst.dev/api", "fst.dev")
          .replace("fstk.dev/api", "fstk.dev")
          .replace("fstnetwork.dev/api", "fstnetwork.dev")
          .replace("fst.network/explorer", "fst.network")
          .replace("fstk.io/explorer", "fstk.io")
          .replace("fst.dev/explorer", "fst.dev")
          .replace("fstk.dev/explorer", "fstk.dev")
          .replace("fstnetwork.dev/explorer", "fstnetwork.dev")
          .replace("fst.network/signin", "fst.network")
          .replace("fstk.io/signin", "fstk.io")
          .replace("fst.dev/signin", "fst.dev")
          .replace("fstk.dev/signin", "fstk.dev")
          .replace("fstnetwork.dev/signin", "fstnetwork.dev")
      );

      // set UI for explorer OMG
      const tmpEndpoint = window.$(e.target).val();
      globalEndpointExplorer = tmpEndpoint
        .replace("api.", "explorer.")
        .replace("https://", "http://")
        .replace("http://", "//");
      reloadHashTable();
      window
        .$("#explorer-preview")
        .html(
          `(The Data Network Explorer for the Data Entry is at: <a id="explorer-preview-link" href="${globalEndpointExplorer}" target="_blank">${globalEndpointExplorer}</a>)`
        );

      return tmpEndpoint;
    })
    .toProperty("");

  const signInIdChangeStream = window
    .$("#signin-id")
    .asEventStream("change")
    .map(e => {
      window.$(e.target).removeClass("bad-form");
      window.$("#signin-pw").removeClass("bad-form");
      return window.$(e.target).val();
    })
    .toProperty("");

  const signInPwChangeStream = window
    .$("#signin-pw")
    .asEventStream("change")
    .map(e => {
      window.$(e.target).removeClass("bad-form");
      window.$("#signin-id").removeClass("bad-form");
      return window.$(e.target).val();
    })
    .toProperty("");

  const ethKPPChangeStream = window
    .$("#ethk-pp")
    .asEventStream("change")
    .map(e => {
      window.$(e.target).removeClass("bad-form");
      window.$("#address").val("");
      return window.$(e.target).val();
    })
    .toProperty("");

  const mutationReqChangeStream = window
    .$("#mutation-req")
    .asEventStream("change")
    .map(e => {
      window.$(e.target).removeClass("bad-form");
      return window.$(e.target).val();
    })
    .toProperty("");

  // signin part combination
  window.Bacon.combineAsArray(
    endpointChangeStream,
    signInIdChangeStream,
    signInPwChangeStream
  ).onValue(arr => {
    console.log(arr);

    // reset UI
    window.$("#authorization-header").val("");
    window.$("#address").val("");
    window.$("#mutation-resp").val("");
    window.$("#txhash").val("");
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#authorization-header").removeClass("bad-form");
    window.$("#address").removeClass("bad-form");
    window.$("#mutation-resp").removeClass("bad-form");
    window.$("#txhash").removeClass("bad-form");

    // for authorization header
    if (arr.every(content => content.length > 0)) {
      getAuthorizationHeaderUI();
    }
  });

  // ethereumKey part combination
  window.Bacon.combineAsArray(
    globalBus.filter(cond => cond === "COND_AUTHED"),
    ethKPPChangeStream
  ).onValue(arr => {
    console.log(arr);

    // reset UI
    window.$("#address").val("");
    window.$("#mutation-resp").val("");
    window.$("#txhash").val("");
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#address").removeClass("bad-form");
    window.$("#mutation-resp").removeClass("bad-form");
    window.$("#txhash").removeClass("bad-form");

    // for decrypting ethereum key
    if (arr.every(content => content.length > 0)) {
      getAddressUI();
    }
  });

  // mutation req part combination
  window.Bacon.combineAsArray(
    globalBus.filter(cond => cond === "COND_AUTHED"),
    mutationReqChangeStream
  ).onValue(arr => {
    console.log(arr);

    // reset UI
    window.$("#mutation-resp").val("");
    window.$("#txhash").val("");
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#mutation-resp").removeClass("bad-form");
    window.$("#txhash").removeClass("bad-form");

    // for decrypting ethereum key
    if (arr.every(content => content.length > 0)) {
      getMutationRespUI();
    }
  });

  // all left form combination
  window.Bacon.combineAsArray(
    globalBus.filter(cond => cond === "COND_AUTHED"),
    globalBus.filter(cond => cond === "COND_MUT_RESP"),
    globalBus.filter(cond => cond === "COND_KEY_DECRYPT")
  ).onValue(arr => {
    console.log(arr);

    window.$("#submit-transaction").html("6. Sign and Submit Transaction");

    // all left form have input
    window.$("#submit-transaction").prop("disabled", false);
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
  window.$("#go-to-page-api-tx-tool").on("click", () => {
    window.$(".page-hashing-tool").addClass("cloak");
    window.$(".page-api-tx-tool").removeClass("cloak");
  });

  window.$("#go-to-page-hashing-tool").on("click", () => {
    window.$(".page-api-tx-tool").addClass("cloak");
    window.$(".page-hashing-tool").removeClass("cloak");
  });

  window.$("#go-to-page-api-tx-tool").click();

  // manually emit event
  window.$("#endpoint").trigger("change");
  window.$("#sigin-id").trigger("change");
  window.$("#sigin-pw").trigger("change");
  window.$("#ethk-pp").trigger("change");
  window.$("#mutation-req").trigger("change");
});
