$(function() {
  Bacon.$.init($);

  var endpointStream = $("#endpoint")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });
  var signinIdStream = $("#signin-id")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });
  var signinPwStream = $("#signin-pw")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });
  var ethkppStream = $("#ethk-pp")
    .asEventStream("change")
    .map(ev => {
      return $(ev.target).val();
    });

  var signStream = Bacon.combineAsArray(
    endpointStream,
    signinIdStream,
    signinPwStream
  );

  signStream.onValue(arr => {
    var endpoint = arr[0];
    var id = arr[1];
    var pw = arr[2];

    axios({
      url: "/signin",
      baseURL: endpoint,
      method: "post",
      withCredentials: false,
      data: {
        query: `mutation signIn {\n  signIn(input: { id: "${id}", password: "${pw}" }) {\n    access_token\n  }\n}\n`
      }
    }).then(resp => {
      console.log(resp);
    });
  });
});
