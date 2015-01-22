var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 3000;

server.listen(port, function () {
    console.log('Server listening on port %d', port);
});

app.use(express.static(__dirname));

var users = {};
var sessions = {};
var AGREEMENT = 10;
var UPDATE = -1;
var ID_LENGTH = 4;

//get a random id and assign it to a socket if available
//then keep track of it being in use
function makeId(collection, socket) {
    var text;
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    do {
        text = "";
        for(var i = 0; i < ID_LENGTH; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
    } while (text in collection); //keep going if the id exists

    collection[text] = socket; //keep track of it
    if (socket) {
        socket.id = text;
    }
    return text;
}

function max(array) {
    var par = [];

    for (var i = 0; i < array.length; i++) {
        if (!isNaN(array[i])) {
            par.push(array[i]);
        } else {
            par.push(0);
        }
    }
    return Math.max.apply(Math, par);
}

io.on('connection', function (socket) {
    //when a user enters the app
    socket.on('create user', function () {
        //create random id and assign it to socket
        //keep track of it being in use
        var id = makeId(users, socket);
        socket.emit('created user', {
            userId: id
        });
        console.log("User " + id + " created");
    });

    //when a user create a new session
    socket.on('create session', function (invitedUsers) {
        //if user is already in a session, cannot create a new one
        if (socket.currentSession) {
            socket.emit('err', {
                message: "You are already in a session."
            });
            return;
        }

        var sessionId = makeId(sessions, null);

        //create a new session
        sessions[sessionId] = {
            host: socket.id,
            started: false,
            created: (new Date().getTime())/1000,
            users: {}
        };

        socket.emit("created session", {
            sessionId: sessionId
        });

        console.log("Session " + sessionId + " created");
    });

    //when a user enters a session
    socket.on('enter session', function (sessionId) {
        //if user is already in a session, cannot enter another one
        if (socket.currentSession) {
            socket.emit('err', {
                message: "You are already in a session."
            });
            return;
        }

        //check if session is valid
        if (!(sessionId in sessions)) {
            socket.emit('err', {
                message: "Session does not exist."
            });
            return;
        }

        //check if registration is still open (2 mins)
        var timeDiff = (new Date().getTime())/1000 - sessions[sessionId].created;
        if (timeDiff > 120) {
            socket.emit('err', {
                message: "Session registration closed."
            });
            return;
        }

        socket.currentSession = sessionId;
        //give the user a spot in the session
        sessions[sessionId].users[socket.id] = 0;

        socket.emit('entered session', {
            userId: socket.id,
            sessionId: sessionId
        });

        console.log("User " + socket.id + " entered session " + sessionId);
    });

    function endSession () {
        if (socket.currentSession === null) {
            socket.emit('err', {
                message: "You are not in a session."
            });
            return;
        }

        var currentSession = socket.currentSession;
        var session = sessions[currentSession];

        //check if host, only host can end session
        if (sessions[currentSession].host != socket.id) {
            socket.emit('err', {
                message: "Only the host can end the session."
            });
            return;
        }

        //notify all users in session that it has ended
        for (userId in session.users) {
            if (!(userId in users)) {
                continue;
            }
            users[userId].emit('ended session', {
                sessionId: currentSession
            });
            users[userId].currentSession = null;
        }

        console.log("User " + socket.id + " ended session " + currentSession);

        delete sessions[currentSession];
    }

    //when a host user ends a session
    socket.on('end session', endSession);

    //when a nonhost user leaves a session
    socket.on('leave session', function () {
        //can't leave a session if user isn't in a session
        var currentSession = socket.currentSession;
        if (currentSession === null) {
            socket.emit('err', {
                message: "You are not in a session."
            });
            return;
        }

        //check if host, host must end session and not leave it
        if (sessions[currentSession].host == socket.id) {
            socket.emit('err', {
                message: "Everyone besides the host can leave a session."
            });
            return;
        }

        //remove the user's spot in the session
        delete sessions[currentSession].users[socket.id];

        socket.emit('left session', {
            userId: socket.id,
            sessionId: currentSession
        });

        console.log("User " + socket.id + " left session " + currentSession);
        socket.currentSession = null;
    });

    //when a user sends a choice
    socket.on('make choice', function (answer, oldSessionId) {
        if (socket.currentSession === null && !oldSessionId) {
            socket.emit('err', {
                message: "You are not in a session."
            });
            return;
        }

        var currentSession = socket.currentSession || oldSessionId;

        //if a user leaves a session or exits the app
        var session = sessions[currentSession];

        if (!session) {
            return;
        }

        if (answer > 0) {
            //make an entry in the session
            sessions[currentSession].users[socket.id] = answer;
            session = sessions[currentSession]; //capture updated users[]

            console.log("User " + socket.id + " sent answer " + answer + " to session " + currentSession);
        }

        var answered = 0;
        var check = 0;
        var sessionUsers = [];

        if (Object.keys(session.users).length == 0) {
            delete sessions[currentSession];
            console.log("Session " + currentSession + " ended");
            return;
        }

        //check if everyone in the session answered
        for (userId in session.users) {
            sessionUsers.push(userId);
            if (session.users[userId] != 0) {
                ++answered;

                if (!session.started && session.users[userId] == 3) {
                    ++check;
                }
            }
        }

        //if not everyone has answered, do nothing
        if (answered < (Object.keys(session.users).length)) {
            return;
        }

        //check if we can begin
        if (!session.started) {
            if (check == sessionUsers.length) {
                //indicate the start
                sessions[currentSession].started = true;
                console.log("Session " + currentSession + " started");

                //reset the answers
                for (userId in session.users) {
                    sessions[currentSession].users[userId] = 0;
                    users[userId].emit("session started");
                }

            }
            return;
        }

        //if there are only 2 users in the session
        if (answered == 2) {
            //if their answers differ, send them each other's responses
            var answer1 = session.users[sessionUsers[0]];
            var answer2 = session.users[sessionUsers[1]];
            if (answer1 != answer2) {
                users[sessionUsers[0]].emit('beep', {
                    userId: sessionUsers[0],
                    count: answer2
                });
                console.log("User " + sessionUsers[0] + " received " + answer2);

                users[sessionUsers[1]].emit('beep', {
                    userId: sessionUsers[1],
                    count: answer1
                });
                console.log("User " + sessionUsers[1] + " received " + answer1);
            } else { //indicate new round to each user
                sessionUsers.forEach(function(userId) {
                    users[userId].emit('beep', {
                        userId: userId,
                        count: AGREEMENT
                    });
                    console.log("User " + userId + " received " + AGREEMENT);
                });
            }

            //reset the users' answers
            for (userId in session.users) {
                sessions[currentSession].users[userId] = 0;
            }
        } else { //if there are multiple users in the session
            //take a tally of the answer frequencies
            var poll = [];
            sessionUsers.forEach(function (userId) {
                if (poll[session.users[userId]]) {
                    ++poll[session.users[userId]]; //increment base
                } else {
                    poll[session.users[userId]] = 1; //set base
                }
            });

            //get the most frequent answer
            var popular = poll.indexOf(max(poll));
            var pattern = AGREEMENT; //default to agreement

            for (var i = 0; i < poll.length; ++i) {
                //if there isn't a consensus, send most popular answer
                if (poll[i] != undefined && i != popular) {
                    pattern = popular;
                }
            }

            //send pattern to each user in session
            sessionUsers.forEach(function(userId) {
                users[userId].emit('beep', {
                    userId: userId,
                    count: pattern
                });

                console.log("User " + userId + " received " + pattern);
                //reset user's answer
                sessions[currentSession].users[userId] = 0;
            });
        }
    });

    //when a user exits the app
    socket.on('exit', function () {
        //if the user is in a session, remove her
        var currentSession = socket.currentSession;
        if (currentSession) {
            //if the user is the host of the session
            if (sessions[currentSession].host == socket.id) {
                endSession();
            } else {
                delete sessions[currentSession].users[socket.id];
            }

            socket.emit("exited", {
                userId: socket.id,
                sessionId: currentSession
            });

        }

        socket.currentSession = null;
        console.log("User " + socket.id + " left the app");
        //free from id pool
        socket.id = null;
        delete users[socket.id];
    });
});
