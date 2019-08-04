importScripts("./eth-key-lib-js-browser.js");

onmessage = function(e) {
  let walletObj = null;

  try {
    walletObj = EthKeyLibBrowser.DecryptEthereumKeyJson(
      e.data.passphrase,
      e.data.ethereumKeyJson
    );
  } catch (err) {
    console.error(err);
  }

  postMessage(JSON.stringify(walletObj || { wrong: "passphrase" }));
};
