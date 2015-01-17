$(function() {
  // Initialize varibles
  var $window = $(window);
  var $chat = $(".chatArea");

  // Prompt for setting a username

  var socket = io();
  var userId;

  init();

  function init() {
      socket.emit("create user");
  }

  function br() {
      return "<br/>"
  }

  socket.on("created user", function (data) {
      $(".userId").text(data.userId);
      userId = data.userId;
  });

  $("#create_session").click(function() {
    socket.emit("create session", prompt("User IDs").split(","));
  });

  socket.on("invite", function(data) {
      $chat.append("Invited to " + data.sessionId + br());
  });

  $("#enter_session").click(function() {
    socket.emit("enter session", prompt("Session ID"));
  });

  socket.on("entered session", function(data) {
      $chat.append(data.userId + " entered session " + data.sessionId + br());
  });

  $("#end_session").click(function() {
      socket.emit("end session");
  });

  socket.on("ended session", function(data) {
      $chat.append(data.userId + " ended session " + data.sessionId + br());
  });

  $("#leave_session").click(function() {
      socket.emit("leave session");
  });

  socket.on("left session", function(data) {
    $chat.append(data.userId + " left session " + data.sessionId + br());
  });

  $("#make_choice").click(function() {
      socket.emit("make choice", prompt("Count"));
  });

  socket.on("beep", function(data) {
      $chat.append(data.userId + " received " + data.count + br());
  });

  $("#exit").click(function() {
      socket.emit("exit");
  });

});
