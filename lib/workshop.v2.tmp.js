"use strict";

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance"); }

function _iterableToArrayLimit(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

var ppMap = {};
var graphql2server = "https://graphql2.fstk.io";
var globalEndpointExplorer = "";
var globalBus = null;

function decryptEthereumKeyPromise(passphrase, ethereumKeyJson) {
  if (window.Worker) {
    var theWorker = new Worker("./lib/eth-key-lib-worker.js");
    theWorker.postMessage({
      passphrase: passphrase,
      ethereumKeyJson: ethereumKeyJson
    });
    return new Promise(function (res) {
      theWorker.onmessage = function (result) {
        theWorker.terminate();
        var tmpObj = JSON.parse(result.data);

        if (tmpObj.wrong === "passphrase") {
          return res(null);
        }

        tmpObj.privateKeyBuffer = window.buffer.Buffer.from(tmpObj.privateKeyBuffer);
        res(tmpObj);
      };
    }).then(function (result) {
      if (result) {
        return result;
      }

      return null;
    });
  } else {
    return Promise.resolve(window.EthKeyLibBrowser.DecryptEthereumKeyJson(passphrase, ethereumKeyJson)).then(function (result) {
      if (result) {
        return result;
      }

      return null;
    });
  }
}

function parseMutationResp(content) {
  var resp = {};

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
  return window.EthKeyLibBrowser.SignTransaction(privateKeyBuffer, txObj) || null;
}

function getAuthorizationHeaderUI() {
  var endpoint = window.$("#endpoint").val();
  var id = window.$("#signin-id").val();
  var pw = window.$("#signin-pw").val();

  if ([endpoint, id, pw].every(function (content) {
    return content.length > 0;
  })) {
    window.axios({
      url: "/to/".concat(endpoint, "/signin"),
      baseURL: graphql2server,
      method: "post",
      withCredentials: false,
      data: {
        query: "\n          mutation signIn {\n            signIn(input: { id: \"".concat(id, "\", password: \"").concat(pw, "\" }) {\n              access_token\n            }\n          }\n      ")
      }
    }).then(function (resp) {
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

      var access_token = resp.data.data.signIn.access_token;
      window.$("#authorization-header").attr("data", access_token);
      window.$("#authorization-header").val(JSON.stringify({
        Authorization: "Bearer ".concat(access_token)
      }, null, 2));
      globalBus.push("COND_AUTHED");
    });
  }
}

function getAddressUI() {
  var endpoint = window.$("#endpoint").val();
  var id = window.$("#signin-id").val();
  var pw = window.$("#signin-pw").val();
  var passphrase = window.$("#ethk-pp").val();
  var access_token = window.$("#authorization-header").attr("data") || "";

  if ([endpoint, id, pw, passphrase, access_token].every(function (content) {
    return content.length > 0;
  })) {
    window.axios({
      url: "/to/".concat(endpoint, "/api"),
      baseURL: graphql2server,
      method: "post",
      withCredentials: false,
      headers: {
        Authorization: "Bearer ".concat(access_token)
      },
      data: {
        query: "\n            query ethereumKey {\n              ethereumKey {\n                version\n                address\n                crypto\n              }\n            }\n          "
      }
    }).then(function (resp) {
      if (!resp.data.data.ethereumKey) {
        return null;
      }

      window.$("#address").attr("data", resp.data.data.ethereumKey);
      return resp.data.data.ethereumKey;
    }).then(function (ethereumKey) {
      if (!ethereumKey) {
        return null;
      } // set UI (decrypting ethereumKey)


      window.$("#address").val("Decrypting the wallet file (key file)...");
      return Promise.resolve(true).then(function (_) {
        if (ppMap["".concat([endpoint, id, pw, passphrase].join("-"))] !== undefined) {
          return ppMap["".concat([endpoint, id, pw, passphrase].join("-"))];
        } else {
          return decryptEthereumKeyPromise(passphrase, ethereumKey);
        }
      }).then(function (pp) {
        if (!pp) {
          // set UI (bad passphrase)
          window.$("#ethk-pp").addClass("bad-form");
          window.$("#address").val("Wrong passphrase");
          return null;
        }

        return pp;
      });
    }).then(function (pp) {
      if (pp) {
        ppMap["".concat([endpoint, id, pw, passphrase].join("-"))] = pp; // set UI (decrypt ethereumKey good)

        window.$("#address").val(pp.checksumAddressString);
        window.$("#address").unbind("click");
        window.$("#address").on("click", function () {
          window.open(endpoint.replace("api", "explorer") + "/address/" + pp.checksumAddressString, "_blank");
        });
        globalBus.push("COND_KEY_DECRYPT");
      }
    });
  }
}

function getMutationRespUI() {
  var endpoint = window.$("#endpoint").val();
  var id = window.$("#signin-id").val();
  var pw = window.$("#signin-pw").val();
  var access_token = window.$("#authorization-header").attr("data") || "";
  var mutationReq = window.$("#mutation-req").val();

  if ([endpoint, id, pw, access_token].every(function (content) {
    return content.length > 0;
  })) {
    window.axios({
      url: "/to/".concat(endpoint, "/api"),
      baseURL: graphql2server,
      method: "post",
      withCredentials: false,
      headers: {
        Authorization: "Bearer ".concat(access_token)
      },
      data: {
        query: mutationReq
      }
    }).then(function (resp) {
      if (!resp.data.data || !resp.data.data) {
        window.$("#submit-transaction").prop("disabled", true);
        window.$("#mutation-resp").addClass("bad-form");
        window.$("#mutation-resp").val("Server Error...");
        return null;
      }

      var parsedMutationResp = parseMutationResp(JSON.stringify(resp.data));

      if (!parsedMutationResp) {
        window.$("#submit-transaction").prop("disabled", true);
        window.$("#mutation-resp").addClass("bad-form");
        window.$("#mutation-resp").val("Response malformed: ".concat(resp.data));
        return null;
      }

      window.$("#mutation-resp").val(JSON.stringify(resp.data, null, 2));
      window.$("#mutation-resp").attr("data", JSON.stringify(parsedMutationResp));
      globalBus.push("COND_MUT_RESP");
    }).catch(function (error) {
      window.$("#submit-transaction").prop("disabled", true);
      window.$("#mutation-resp").addClass("bad-form");

      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        window.$("#mutation-resp").val(JSON.stringify(error.response, null, 2));
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
  var endpoint = window.$("#endpoint").val();
  var id = window.$("#signin-id").val();
  var pw = window.$("#signin-pw").val();
  var passphrase = window.$("#ethk-pp").val();
  var mutationReq = window.$("#mutation-req").val();
  var mutationResp = window.$("#mutation-resp").val();
  var access_token = window.$("#authorization-header").attr("data") || "";

  var _parsedMutationResp = window.$("#mutation-resp").attr("data") || "";

  if ([endpoint, id, pw, passphrase, mutationReq, mutationResp, access_token, _parsedMutationResp].every(function (content) {
    return content.length > 0;
  })) {
    // set UI (freeze or reset all UI)
    window.$("#endpoint").prop("readonly", true);
    window.$("#signin-id").prop("readonly", true);
    window.$("#signin-pw").prop("readonly", true);
    window.$("#ethk-pp").prop("readonly", true);
    window.$("#mutation-req").prop("readonly", true);
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true); // set UI (submitting transaction)

    window.$("#txhash").val("Submitting the transaction...");
    var parsedMutationResp = "";

    try {
      parsedMutationResp = JSON.parse(_parsedMutationResp);
    } catch (err) {
      console.error(err);
      return null;
    }

    var pp = ppMap["".concat([endpoint, id, pw, passphrase].join("-"))];
    var signedTx = signTransaction(pp.privateKeyBuffer, parsedMutationResp.transaction);
    var submitToken = parsedMutationResp.submitToken;
    window.axios({
      url: "/to/".concat(endpoint, "/api"),
      baseURL: graphql2server,
      method: "post",
      withCredentials: false,
      headers: {
        Authorization: "Bearer ".concat(access_token)
      },
      data: {
        query: "\n            mutation submitTransaction {\n              submitTransaction(input: { signedTx: \"".concat(signedTx, "\", submitToken: \"").concat(submitToken, "\" }) {\n                transactionHash\n              }\n            }\n            ")
      }
    }).then(function (resp) {
      if (!resp.data.data.submitTransaction) {
        // set UI (bad submitTransaction)
        window.$("#txhash").val("The transaction is expired or duplicated on blockchain");
        window.$("#txhash").addClass("bad-form");
        return null;
      }

      var latestTxHash = resp.data.data.submitTransaction.transactionHash; // set UI (submitting transaction good or all bad)

      window.$("#submit-transaction").html("Transaction Submitted");
      window.$("#txhash").val(latestTxHash);
      window.$("#check-txhash").prop("disabled", false);
      window.$("#check-txhash").unbind("click");
      window.$("#check-txhash").on("click", function () {
        window.open(endpoint.replace("api", "explorer") + "/tx/" + latestTxHash, "_blank");
      }); // set UI (defreeze UI)

      window.$("#endpoint").prop("readonly", false);
      window.$("#signin-id").prop("readonly", false);
      window.$("#signin-pw").prop("readonly", false);
      window.$("#ethk-pp").prop("readonly", false);
      window.$("#mutation-req").prop("readonly", false);
    }).catch(function (error) {
      // set UI (bad submitTransaction)
      window.$("#txhash").addClass("bad-form");
      window.$("#mutation-resp").addClass("bad-form");

      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        window.$("#mutation-resp").val(JSON.stringify(error.response, null, 2));
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
  return window.localStorage.setItem("fstnetwork-workshop", JSON.stringify(obj));
}

function reloadHashTable() {
  var obj = loadLocalStorage();

  if (!obj.hashTable) {
    obj.hashTable = [];
  } // render hash table body


  var tmpTbody = obj.hashTable.map(function (rowObj, i) {
    var de_identified_entry_link = "".concat(rowObj.de_identified_entry);

    if (globalEndpointExplorer !== "") {
      de_identified_entry_link = "<a style=\"text-decoration-line: underline;\" href=\"".concat(globalEndpointExplorer, "/address/0x").concat(rowObj.de_identified_entry, "\" target=\"_blank\">").concat(rowObj.de_identified_entry, "</a>");
    }

    var rowHtml = "\n        <tr id=\"row-".concat(rowObj.hash, "\">\n          <td>").concat(rowObj.original_content, "</td>\n          <td>").concat(rowObj.salt === "" ? "(empty)" : rowObj.salt, "</td>\n          <td>").concat(rowObj.hash, "</td>\n          <td>").concat(de_identified_entry_link, "</td>\n          <td><button style=\"margin-bottom: 0px;\" id=\"delete-").concat(rowObj.hash, "-row\">delete</button></td>\n        </tr>\n    ");
    return [rowObj, rowHtml, i];
  });

  if (tmpTbody.length === 0) {
    return window.$("#hash-table-body").html("<tr><td>(table is empty)</td></tr>");
  }

  window.$("#hash-table-body").html(tmpTbody.map(function (_ref) {
    var _ref2 = _slicedToArray(_ref, 3),
        _1 = _ref2[0],
        rowHtml = _ref2[1],
        _2 = _ref2[2];

    return rowHtml;
  }).join("")); // bind events

  tmpTbody.forEach(function (_ref3) {
    var _ref4 = _slicedToArray(_ref3, 3),
        rowObj = _ref4[0],
        _1 = _ref4[1],
        i = _ref4[2];

    window.$("#delete-".concat(rowObj.hash, "-row")).unbind("click");
    window.$("#delete-".concat(rowObj.hash, "-row")).on("click", function () {
      window.$("#delete-".concat(rowObj.hash, "-row")).unbind("click");
      removeRowFromHashTable(i);
    });
  });
}

function addRowToHashTable(rowObj) {
  if (!rowObj) return;
  var obj = loadLocalStorage();

  if (!obj.hashTable) {
    obj.hashTable = [];
  }

  if (obj.hashTable.some(function (_rowObj) {
    return _rowObj.hash === rowObj.hash;
  })) {
    return "duplicated";
  }

  obj.hashTable.push(rowObj);
  setLocalStorage(obj);
  reloadHashTable();
}

function removeRowFromHashTable(index) {
  if (index < 0) return;
  var obj = loadLocalStorage();
  if (!obj.hashTable) return;
  if (obj.hashTable.length === 0) return;
  obj.hashTable.splice(index, 1);
  setLocalStorage(obj);
  reloadHashTable();
}

window.$(function () {
  // bus
  globalBus = new window.Bacon.Bus(); //
  // page api tx tool
  // form check

  var endpointChangeStream = window.$("#endpoint").asEventStream("change").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$(e.target).val(window.$(e.target).val().replace("fst.network/api", "fst.network").replace("fstk.io/api", "fstk.io").replace("fst.dev/api", "fst.dev").replace("fstk.dev/api", "fstk.dev").replace("fstnetwork.dev/api", "fstnetwork.dev").replace("fst.network/explorer", "fst.network").replace("fstk.io/explorer", "fstk.io").replace("fst.dev/explorer", "fst.dev").replace("fstk.dev/explorer", "fstk.dev").replace("fstnetwork.dev/explorer", "fstnetwork.dev").replace("fst.network/signin", "fst.network").replace("fstk.io/signin", "fstk.io").replace("fst.dev/signin", "fst.dev").replace("fstk.dev/signin", "fstk.dev").replace("fstnetwork.dev/signin", "fstnetwork.dev")); // set UI for explorer OMG

    var tmpEndpoint = window.$(e.target).val();
    globalEndpointExplorer = tmpEndpoint.replace("api.", "explorer.").replace("https://", "http://").replace("http://", "//");
    reloadHashTable();
    window.$("#explorer-preview").html("(The Blockchain Explorer for the Data Entry is at: <a id=\"explorer-preview-link\" href=\"".concat(globalEndpointExplorer, "\" target=\"_blank\">").concat(globalEndpointExplorer, "</a>)"));
    return tmpEndpoint;
  }).toProperty("");
  var signInIdChangeStream = window.$("#signin-id").asEventStream("change").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$("#signin-pw").removeClass("bad-form");
    return window.$(e.target).val();
  }).toProperty("");
  var signInPwChangeStream = window.$("#signin-pw").asEventStream("change").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$("#signin-id").removeClass("bad-form");
    return window.$(e.target).val();
  }).toProperty("");
  var ethKPPChangeStream = window.$("#ethk-pp").asEventStream("change").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$("#address").val("");
    return window.$(e.target).val();
  }).toProperty("");
  var mutationReqChangeStream = window.$("#mutation-req").asEventStream("change").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    return window.$(e.target).val();
  }).toProperty(""); // signin part combination

  window.Bacon.combineAsArray(endpointChangeStream, signInIdChangeStream, signInPwChangeStream).onValue(function (arr) {
    console.log(arr); // reset UI

    window.$("#authorization-header").val("");
    window.$("#address").val("");
    window.$("#mutation-resp").val("");
    window.$("#txhash").val("");
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#authorization-header").removeClass("bad-form");
    window.$("#address").removeClass("bad-form");
    window.$("#mutation-resp").removeClass("bad-form");
    window.$("#txhash").removeClass("bad-form"); // for authorization header

    if (arr.every(function (content) {
      return content.length > 0;
    })) {
      getAuthorizationHeaderUI();
    }
  }); // ethereumKey part combination

  window.Bacon.combineAsArray(globalBus.filter(function (cond) {
    return cond === "COND_AUTHED";
  }), ethKPPChangeStream).onValue(function (arr) {
    console.log(arr); // reset UI

    window.$("#address").val("");
    window.$("#mutation-resp").val("");
    window.$("#txhash").val("");
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#address").removeClass("bad-form");
    window.$("#mutation-resp").removeClass("bad-form");
    window.$("#txhash").removeClass("bad-form"); // for decrypting ethereum key

    if (arr.every(function (content) {
      return content.length > 0;
    })) {
      getAddressUI();
    }
  }); // mutation req part combination

  window.Bacon.combineAsArray(globalBus.filter(function (cond) {
    return cond === "COND_AUTHED";
  }), mutationReqChangeStream).onValue(function (arr) {
    console.log(arr); // reset UI

    window.$("#mutation-resp").val("");
    window.$("#txhash").val("");
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#mutation-resp").removeClass("bad-form");
    window.$("#txhash").removeClass("bad-form"); // for decrypting ethereum key

    if (arr.every(function (content) {
      return content.length > 0;
    })) {
      getMutationRespUI();
    }
  }); // all left form combination

  window.Bacon.combineAsArray(globalBus.filter(function (cond) {
    return cond === "COND_AUTHED";
  }), globalBus.filter(function (cond) {
    return cond === "COND_MUT_RESP";
  }), globalBus.filter(function (cond) {
    return cond === "COND_KEY_DECRYPT";
  })).onValue(function (arr) {
    console.log(arr);
    window.$("#submit-transaction").html("6. Sign and Submit Transaction"); // all left form have input

    window.$("#submit-transaction").prop("disabled", false);
  });
  window.$("#submit-transaction").on("click", afterClickSubmitTransactionButton); //
  // page hashing tool

  Bacon.combineAsArray(window.$("#hash-content").asEventStream("input").map(function (e) {
    return window.$(e.target).val();
  }).toProperty(""), window.$("#hash-salt").asEventStream("input").map(function (e) {
    return window.$(e.target).val() || "";
  }).toProperty("")).onValue(function (_ref5) {
    var _ref6 = _slicedToArray(_ref5, 2),
        content = _ref6[0],
        salt = _ref6[1];

    if (content + salt === "") {
      window.$("#hash-save").prop("disabled", true);
      window.$("#hash-result").val("");
      return window.$("#hash-result-20bytes").val("");
    }

    var tmpSalt = salt === "" ? "" : window.keccak256(salt);
    window.$("#hash-save").prop("disabled", false);
    window.$("#hash-result").val(window.keccak256(content + tmpSalt));
    window.$("#hash-result-20bytes").val(window.$("#hash-result").val().slice(0, 40));
  });
  reloadHashTable();
  window.$("#hash-save").on("click", function () {
    addRowToHashTable({
      hash: window.$("#hash-result").val(),
      original_content: window.$("#hash-content").val(),
      salt: window.$("#hash-salt").val(),
      de_identified_entry: window.$("#hash-result-20bytes").val()
    });
  }); //
  // goto page api tx tool first

  window.$("#go-to-page-api-tx-tool").on("click", function () {
    window.$(".page-hashing-tool").addClass("cloak");
    window.$(".page-api-tx-tool").removeClass("cloak");
  });
  window.$("#go-to-page-hashing-tool").on("click", function () {
    window.$(".page-api-tx-tool").addClass("cloak");
    window.$(".page-hashing-tool").removeClass("cloak");
  });
  window.$("#go-to-page-api-tx-tool").click(); // manually emit event

  window.$("#endpoint").trigger("change");
  window.$("#sigin-id").trigger("change");
  window.$("#sigin-pw").trigger("change");
  window.$("#ethk-pp").trigger("change");
  window.$("#mutation-req").trigger("change");
});
