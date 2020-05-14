//////////////////////////////////////////////////////////////////////////
// Configuration                                                        //
//////////////////////////////////////////////////////////////////////////
const app = require('express')();
const helmet = require('helmet')
app.use(helmet());
app.get('/', function(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.send('OK');
});
const server = require('http').Server(app);
const io = require('socket.io')(server);

server.listen(process.env.PORT || 3000, function() {
  console.log(`Listening on port ${server.address().port}`);
});

//////////////////////////////////////////////////////////////////////////
// State                                                                //
//////////////////////////////////////////////////////////////////////////

// In-memory store of all the sessions
// the keys are the session IDs (strings)
// the values have the form: {
//   id: 'cba82ca5f59a35e6',                                                                // 8 random octets
//   lastKnownTime: 123,                                                                    // milliseconds from the start of the video
//   lastKnownTimeUpdatedAt: new Date(),                                                    // when we last received a time update
//   ownerId: '3d16d961f67e9792',                                                           // id of the session owner (if any)
//   isPlaying: true | false,                                                               // whether the video is playing or paused
//   userIds: ['3d16d961f67e9792', ...],                                                    // ids of the users in the session
//   ////////videoLink: https://animepahe.com/play/...                                              // Default streaming website used by owner
// }
let sessions = {};

// In-memory store of all the users
// the keys are the user IDs (strings)
// the values have the form: {
//   id: '3d16d961f67e9792',        // 8 random octets
//   sessionId: 'cba82ca5f59a35e6', // id of the session, if one is joined
//   socket: <websocket>,           // the websocket
//   discord: TODO
// }
let users = {};

//////////////////////////////////////////////////////////////////////////
// Utility functions                                                    //
//////////////////////////////////////////////////////////////////////////

function makeId() { // generate a random ID with 64 bits of entropy
  var result = '';
  var hexChars = '0123456789abcdef';
  for (var i = 0; i < 16; i += 1) {
    result += hexChars[Math.floor(Math.random() * 16)];
  }
  return result;
}

function validateId(id) {
  return typeof id === 'string' && id.length === 16;
}

function validateBoolean(boolean) {
  return typeof boolean === 'boolean';
}

//////////////////////////////////////////////////////////////////////////
// Socket Events                                                        //
//////////////////////////////////////////////////////////////////////////

io.on('connection', function(socket) {
  const userId = makeId();
  while (users.hasOwnProperty(userId)) userId = makeId();
  users[userId] = {
    id: userId,
    sessionId: null,
    socket: socket,
  };
  socket.emit('userId', userId);
  console.log(`User ${userId} connected.`);

  socket.on('createSession', function(data,fn) {
    // Leader needs to send data of the form : {
    //   lastKnownTime: 123,                                                                    // milliseconds from the start of the video
    //   lastKnownTimeUpdatedAt: new Date(),                                                    // when we last received a time update
    //   isPlaying: true | false,                                                               // whether the video is playing or paused
    //   /////videoLink: https://animepahe.com/play/...                                              // Default streaming website used by owner
    // }
    if (!users.hasOwnProperty(userId)) {
      fn({errorMessage: "Disconnected"});
      console.log('The socket sent a message, but is now disconnected.');
      return;
    }
    if (!validateLastKnownTime(data.lastKnownTime)) {
      fn({ errorMessage: 'Invalid lastKnownTime.' });
      console.log(`User ${userId} attempted to update session ${users[userId].sessionId} with invalid lastKnownTime ${JSON.stringify(data.lastKnownTime)}.`);
      return;
    }
    if (!validateBoolean(data.isPlaying)) {
      fn({ errorMessage: 'Invalid isPlaying.' });
      console.log(`User ${userId} attempted to update session ${users[userId].sessionId} with invalid state ${JSON.stringify(data.state)}.`);
      return;
    }
    const sessionId = makeId();
    while (sessions.hasOwnProperty(sessionId)) sessionId = makeId();

    socket.join(sessionId); // Join socket io room
    const session = {
      id: sessionId,
      lastKnownTime: data.lastKnownTime,
      lastKnownTimeUpdatedAt: new Date(),
      ownerId: userId,
      isPlaying: false,
      userIds: [userId],
    };
    users[userId].sessionId = sessionId;
    sessions[session.id] = session;
    fn(sessionId); // Send back sessionId
    console.log(`User ${userId} created session ${users[userId].sessionId}.`);
  });

  socket.on('joinSession', function(sessionId, fn) {
    if (!users.hasOwnProperty(userId)) {
      fn({ errorMessage: 'Disconnected.' });
      console.log('The socket sent a message, but is now disconnected.');
      return;
    }
    if (!validateId(sessionId) || !sessions.hasOwnProperty(sessionId)) {
      fn({ errorMessage: 'Invalid session ID.' });
      console.log(`User ${userId} attempted to join nonexistent session ${JSON.stringify(sessionId)}.`);
      return;
    }
    if (users[userId].sessionId !== null) {
      fn({ errorMessage: 'Already in a session.' });
      console.log(`User ${userId} attempted to join session ${sessionId}, but the user is already in session ${users[userId].sessionId}.`);
      return;
    }
    socket.join(sessionId); // Join socket io room
    users[userId].sessionId = sessionId;
    sessions[sessionId].userIds.push(userId);
    // Ask the leader to update current video timestamp
    users[sessions[sessionId].ownerId].emit('leadRequest');
    console.log(`User ${userId} joined session ${sessionId}.`);
  });

  // socket.on('leaveSession', function(_, fn) {
  //   if (!users.hasOwnProperty(userId)) {
  //     fn({ errorMessage: 'Disconnected.' });
  //     console.log('The socket sent a message, but is now disconnected.');
  //     return;
  //   }
  //   if (users[userId].sessionId === null) {
  //     fn({ errorMessage: 'Not in a session.' });
  //     console.log(`User ${userId} attempted to leave a session, but the user was not in one.`);
  //     return;
  //   }
  //   leaveSession();
  //   console.log(`User ${userId} left session ${sessionId}.`);
  // });

  socket.on('leaderUpdate', function(data, fn) {
    // Leader needs to send data of the form : {
    //   lastKnownTime: 123,                                                                    // milliseconds from the start of the video
    //   lastKnownTimeUpdatedAt: new Date(),                                                    // when we last received a time update
    //   isPlaying: true | false,                                                               // whether the video is playing or paused
    // }
    if (!users.hasOwnProperty(userId)) {
      fn({ errorMessage: 'Disconnected.' });
      console.log('The socket sent a message, but is now disconnected.');
      return;
    }
    if (users[userId].sessionId === null) {
      fn({ errorMessage: 'Not in a session.' });
      console.log(`User ${userId} attempted to update a session, but the user was not in one.`);
      return;
    }
    if (!validateLastKnownTime(data.lastKnownTime)) {
      fn({ errorMessage: 'Invalid lastKnownTime.' });
      console.log(`User ${userId} attempted to update session ${users[userId].sessionId} with invalid lastKnownTime ${JSON.stringify(data.lastKnownTime)}.`);
      return;
    }
    if (!validateBoolean(data.isPlaying)) {
      fn({ errorMessage: 'Invalid isPlaying.' });
      console.log(`User ${userId} attempted to update session ${users[userId].sessionId} with invalid state ${JSON.stringify(data.state)}.`);
      return;
    }
    if (sessions[users[userId].sessionId].ownerId !== null && sessions[users[userId].sessionId].ownerId !== userId) {
      fn({ errorMessage: 'Session locked.' });
      console.log(`User ${userId} attempted to update session ${users[userId].sessionId} but the session is locked by ${sessions[users[userId].sessionId].ownerId}.`);
      return;
    }
    console.log(`User ${userId} updated session ${users[userId].sessionId} with time ${JSON.stringify(data.lastKnownTime)} and state ${data.state} for epoch ${JSON.stringify(data.lastKnownTimeUpdatedAt)}.`);
    
    // Update server values and broadcast to other sockets
    sessions[users[userId].sessionId] = {...sessions[users[userId].sessionId], ...data};
    socket.to(users[userId].sessionId).broadcast('followerUpdate', data);
    
  });

  socket.on('disconnect', function() {
    if (!users.hasOwnProperty(userId)) {
      console.log('The socket sent a message, but is now disconnected.');
      return;
    }
    if (users[userId].sessionId !== null) leaveSession();
    delete users[userId];
    console.log(`User ${userId} disconnected.`);
  });


  function leaveSession(){
    const sessionId = users[userId].sessionId;
    const index = sessions[sessionId].userIds.indexOf(userId);
    if (index > -1) array.splice(index, 1);
    users[userId].sessionId = null;
    socket.leave(sessionId); // Leave socket io room
    if (sessions[sessionId].userIds.length === 0) {
      delete sessions[sessionId];
      console.log(`Session ${sessionId} was deleted because there were no more users in it.`);
    }
  }
});


