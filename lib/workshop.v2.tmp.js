"use strict";

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
        console.log("fuick!!!"); // set UI (bad sign in info)

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

window.$(function () {
  // form check
  window.Bacon.combineAsArray(window.$("#endpoint").asEventStream("input").map(function (e) {
    $(e.target).removeClass("bad-form");
    return $(e.target).val();
  }).toProperty(""), window.$("#signin-id").asEventStream("input").map(function (e) {
    $(e.target).removeClass("bad-form");
    $("signin-pw").removeClass("bad-form");
    return $(e.target).val();
  }).toProperty(""), window.$("#signin-pw").asEventStream("input").map(function (e) {
    $(e.target).removeClass("bad-form");
    $("signin-id").removeClass("bad-form");
    return $(e.target).val();
  }).toProperty(""), window.$("#ethk-pp").asEventStream("input").map(function (e) {
    $(e.target).removeClass("bad-form");
    window.$("#address").val("Waiting for decryption");
    return $(e.target).val();
  }).toProperty(""), window.$("#mutation-resp").asEventStream("input").map(function (e) {
    $(e.target).removeClass("bad-form");
    return $(e.target).val();
  }).toProperty("")).onValue(function (arr) {
    window.$("#address").val("Waiting for decryption");
    window.$("#txhash").val("Waiting for transaction");
    window.$("#txhash").removeClass("bad-form");
    window.$("#submit-transaction").html("Decrypt Key and Submit Transaction");

    if (arr.every(function (content) {
      return content.length > 0;
    })) {
      $("#mutation-resp").scrollTop(0);
      window.$("#submit-transaction").prop("disabled", false);
    } else {
      window.$("#submit-transaction").prop("disabled", true);
    }
  });
  window.$("#submit-transaction").on("click", afterClickSubmitTransactionButton);
});
