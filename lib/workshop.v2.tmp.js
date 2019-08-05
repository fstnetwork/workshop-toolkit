"use strict";

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance"); }

function _iterableToArrayLimit(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(source, true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var ppMap = {};
var graphql2server = "https://graphql2.fstk.io";

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

function afterClickSubmitTransactionButton() {
  var endpoint = window.$("#endpoint").val();
  var id = window.$("#signin-id").val();
  var pw = window.$("#signin-pw").val();
  var passphrase = window.$("#ethk-pp").val();
  var mutationResp = window.$("#mutation-resp").val();

  if ([endpoint, id, pw, passphrase, mutationResp].every(function (content) {
    return content.length > 0;
  })) {
    // set UI (freeze or reset all UI)
    window.$("#endpoint").prop("readonly", true);
    window.$("#signin-id").prop("readonly", true);
    window.$("#signin-pw").prop("readonly", true);
    window.$("#ethk-pp").prop("readonly", true);
    window.$("#mutation-resp").prop("readonly", true);
    window.$("#submit-transaction").prop("disabled", true);
    window.$("#check-txhash").prop("disabled", true);
    window.$("#txhash").val("Waiting for transaction");
    window.$("#address").val("Waiting for decryption"); // signin

    var afterSigninPromise = window.axios({
      url: "/to/".concat(endpoint, "/signin"),
      baseURL: graphql2server,
      method: "post",
      withCredentials: false,
      data: {
        query: "\n          mutation signIn {\n            signIn(input: { id: \"".concat(id, "\", password: \"").concat(pw, "\" }) {\n              access_token\n            }\n          }\n      ")
      }
    }).then(function (resp) {
      if (!resp.data.data.signIn) {
        // set UI (bad sign in info)
        window.$("#signin-id").addClass("bad-form");
        window.$("#signin-pw").addClass("bad-form");
        return null;
      }

      var access_token = resp.data.data.signIn.access_token;
      return {
        endpoint: endpoint,
        id: id,
        pw: pw,
        passphrase: passphrase,
        access_token: access_token
      };
    }); // get ethereumKey

    var afterGetEthereumKeyPromise = afterSigninPromise.then(function (infoObj) {
      if (!infoObj) {
        return null;
      }

      return window.axios({
        url: "/to/".concat(infoObj.endpoint, "/api"),
        baseURL: graphql2server,
        method: "post",
        withCredentials: false,
        headers: {
          Authorization: "Bearer ".concat(infoObj.access_token)
        },
        data: {
          query: "\n            query ethereumKey {\n              ethereumKey {\n                version\n                address\n                crypto\n              }\n            }\n          "
        }
      }).then(function (resp) {
        if (!resp.data.data.ethereumKey) {
          return null;
        }

        infoObj.ethereumKey = resp.data.data.ethereumKey;
        return infoObj;
      });
    }); // decrypt ethereumKey

    var afterKeyDecryptionPromise = afterGetEthereumKeyPromise.then(function (infoObj) {
      if (!infoObj) {
        return null;
      } // set UI (decrypting ethereumKey)


      window.$("#address").val("Decrypting the wallet file (key file)...");
      return Promise.resolve(true).then(function (_) {
        if (ppMap["".concat([infoObj.endpoint, infoObj.id, infoObj.pw, infoObj.passphrase].join("-"))] !== undefined) {
          return ppMap["".concat([infoObj.endpoint, infoObj.id, infoObj.pw, infoObj.passphrase].join("-"))];
        } else {
          return decryptEthereumKeyPromise(infoObj.passphrase, infoObj.ethereumKey);
        }
      }).then(function (pp) {
        if (!pp) {
          // set UI (bad passphrase)
          window.$("#ethk-pp").addClass("bad-form");
          window.$("#address").val("Wrong passphrase");
          return null;
        }

        infoObj.pp = pp;
        return infoObj;
      });
    }).then(function (infoObj) {
      if (infoObj) {
        ppMap["".concat([infoObj.endpoint, infoObj.id, infoObj.pw, infoObj.passphrase].join("-"))] = infoObj.pp; // set UI (decrypt ethereumKey good)

        window.$("#address").val(infoObj.pp.checksumAddressString);
        window.$("#address").unbind("click");
        window.$("#address").on("click", function () {
          window.open(infoObj.endpoint.replace("api", "explorer") + "/address/" + infoObj.pp.checksumAddressString, "_blank");
        });
        return infoObj;
      }

      return null;
    }); // parse mutation resp and sign the transaction

    var afterSignTransactionPromise = afterKeyDecryptionPromise.then(function (infoObj) {
      if (!infoObj) {
        return null;
      } // set UI (submitting transaction)


      window.$("#txhash").val("Submitting the transaction...");
      var parsedMutationResp = parseMutationResp(mutationResp);

      if (!parsedMutationResp) {
        //set UI (bad mutation resp)
        window.$("#mutation-resp").addClass("bad-form");
        return null;
      }

      var submitTransactionObj = {
        signedTx: signTransaction(infoObj.pp.privateKeyBuffer, parsedMutationResp.transaction),
        submitToken: parsedMutationResp.submitToken
      };

      if (!submitTransactionObj.signedTx) {
        //set UI (bad mutation resp)
        window.$("#mutation-resp").addClass("bad-form");
        return null;
      }

      return _objectSpread({}, submitTransactionObj, {}, infoObj);
    }); //submit transaction

    var afterSubmitTransactionPromise = afterSignTransactionPromise.then(function (infoObj) {
      if (!infoObj) {
        return null;
      }

      return window.axios({
        url: "/to/".concat(infoObj.endpoint, "/api"),
        baseURL: graphql2server,
        method: "post",
        withCredentials: false,
        headers: {
          Authorization: "Bearer ".concat(infoObj.access_token)
        },
        data: {
          query: "\n              mutation submitTransaction {\n                submitTransaction(input: { signedTx: \"".concat(infoObj.signedTx, "\", submitToken: \"").concat(infoObj.submitToken, "\" }) {\n                  transactionHash\n                }\n              }\n              ")
        }
      }).then(function (resp) {
        if (!resp.data.data.submitTransaction) {
          // set UI (bad submitTransaction)
          window.$("#txhash").val("The transaction is expired or duplicated on blockchain");
          window.$("#txhash").addClass("bad-form");
          return null;
        }

        infoObj.latestTxHash = resp.data.data.submitTransaction.transactionHash;
        return infoObj;
      });
    }); // set UI (submitting transaction good or all bad)

    afterSubmitTransactionPromise.then(function (infoObj) {
      if (infoObj) {
        window.$("#submit-transaction").html("Transaction Submitted");
        window.$("#txhash").val(infoObj.latestTxHash);
        window.$("#check-txhash").prop("disabled", false);
        window.$("#check-txhash").unbind("click");
        window.$("#check-txhash").on("click", function () {
          window.open(infoObj.endpoint.replace("api", "explorer") + "/tx/" + infoObj.latestTxHash, "_blank");
        });
      } // set UI (defreeze UI)


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
  return window.localStorage.setItem("fstnetwork-workshop", JSON.stringify(obj));
}

function reloadHashTable() {
  var obj = loadLocalStorage();

  if (!obj.hashTable) {
    obj.hashTable = [];
  } // render hash table body


  var tmpTbody = obj.hashTable.map(function (rowObj, i) {
    var rowHtml = "\n        <tr id=\"row-".concat(rowObj.hash, "\">\n          <td>").concat(rowObj.original_content, "</td>\n          <td>").concat(rowObj.salt === "" ? "(empty)" : rowObj.salt, "</td>\n          <td>").concat(rowObj.hash, "</td>\n          <td>").concat(rowObj.de_identified_entry, "</td>\n          <td><button style=\"margin-bottom: 0px;\" id=\"delete-").concat(rowObj.hash, "-row\">delete</button></td>\n        </tr>\n    ");
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
  // page api tx tool
  // form check
  window.Bacon.combineAsArray(window.$("#endpoint").asEventStream("input").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$(e.target).val(window.$(e.target).val().replace("fst.network/api", "fst.network").replace("fstk.io/api", "fstk.io").replace("fst.dev/api", "fst.dev").replace("fstk.dev/api", "fstk.dev").replace("fstnetwork.dev/api", "fstnetwork.dev").replace("fst.network/explorer", "fst.network").replace("fstk.io/explorer", "fstk.io").replace("fst.dev/explorer", "fst.dev").replace("fstk.dev/explorer", "fstk.dev").replace("fstnetwork.dev/explorer", "fstnetwork.dev"));
    return window.$(e.target).val();
  }).toProperty(""), window.$("#signin-id").asEventStream("input").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$("#signin-pw").removeClass("bad-form");
    return window.$(e.target).val();
  }).toProperty(""), window.$("#signin-pw").asEventStream("input").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$("#signin-id").removeClass("bad-form");
    return window.$(e.target).val();
  }).toProperty(""), window.$("#ethk-pp").asEventStream("input").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    window.$("#address").val("Waiting for decryption");
    return window.$(e.target).val();
  }).toProperty(""), window.$("#mutation-resp").asEventStream("input").map(function (e) {
    window.$(e.target).removeClass("bad-form");
    return window.$(e.target).val();
  }).toProperty("")).onValue(function (arr) {
    window.$("#address").val("Waiting for decryption");
    window.$("#txhash").val("Waiting for transaction");
    window.$("#txhash").removeClass("bad-form");
    window.$("#submit-transaction").html("6. Decrypt Key and Submit Transaction");

    if (arr.every(function (content) {
      return content.length > 0;
    })) {
      window.$("#mutation-resp").scrollTop(0);
      window.$("#submit-transaction").prop("disabled", false);
    } else {
      window.$("#submit-transaction").prop("disabled", true);
    }
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

  $("#go-to-page-api-tx-tool").on("click", function () {
    $(".page-hashing-tool").addClass("cloak");
    $(".page-api-tx-tool").removeClass("cloak");
  });
  $("#go-to-page-hashing-tool").on("click", function () {
    $(".page-api-tx-tool").addClass("cloak");
    $(".page-hashing-tool").removeClass("cloak");
  });
  $("#go-to-page-api-tx-tool").click();
});
