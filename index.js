//////////////////////////////////////////////////////////////////////////
// State                                                                //
//////////////////////////////////////////////////////////////////////////

// In-memory store of all the users
// the keys are the user IDs (strings)
// the values have the form: {
//   id: '3d16d961f67e9792',        // 8 random octets
//   socket: <websocket>,           // the websocket
//   discord: TODO
// }
let users = {};
let leaderId = null;

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
app.get('/leaderid', function(req, res) {
  res.send(leaderId);
});

const server = require('http').Server(app);
const io = require('socket.io')(server);
server.listen(process.env.PORT || 3000, function() {
  console.log(`Listening on port ${server.address().port}`);
});

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

function validateLastKnownTime(){
  //TODO
}

function validateDate(){
  //TODO
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
    socket: socket,
  };
  socket.emit('userId', userId);
  console.log(`User ${userId} connected.`);

  socket.on('changeLeader', (callback) => {
    if (!users.hasOwnProperty(userId)) {
      socket.emit("displayError", 'Disconnected.');
      console.log('A socket sent a message, but is now disconnected.');
      return;
    }
    const isLeader = (leaderId == userId);

    if(leaderId != null && !isLeader){ // Can't kick someone out of leader role
      socket.emit("displayError", 'There is already a leader.');
      console.log(`User ${userId} attempted to become the leader when the leader is already ${leaderId}.`);
      return;
    }
    else if (isLeader){ // Leader becomes follower
      leaderId = null;
      console.log(`The socket ${userId} stopped being the leader.`);
      callback(false);
    }
    else{ // Follower becomes leader
      leaderId = userId;
      console.log(`User ${userId} became the leader.`);
      callback(true);
    }
  });

  socket.on('stateUpdate', (data) => {
    if (!users.hasOwnProperty(userId)) {
      socket.emit("displayError", 'Disconnected.');
      console.log('A socket sent a message, but is now disconnected.');
      return;
    }
    if (!validateBoolean(data.leaderIsPaused)) {
      socket.emit("displayError", 'Invalid leaderIsPaused.');
      console.log(`User ${userId} attempted to update with invalid state ${JSON.stringify(data.leaderIsPaused)}.`);
      return;
    }
    if (userId != leaderId) {
      socket.emit("displayError", 'You are not the leader.');
      console.log(`The socket ${userId} tried to change state, but was not the leader (=${leaderId}).`);
      return;
    }
    socket.broadcast.emit('stateUpdate', data);
  });

  socket.on('leaderSeeked', (data) => { // Leader skips to a time
    if (!users.hasOwnProperty(userId)) {
      socket.emit("displayError", 'Disconnected.');
      console.log('The socket sent a message, but is now disconnected.');
      return;
    }
    if (userId != leaderId) {
      socket.emit("displayError", 'You are not the leader.');
      console.log(`The socket ${userId} tried to seek, but was not the leader (=${leaderId}).`);
      return;
    }
    // TODO : VALIDATE DATA
    socket.broadcast.emit('timeUpdate', data); // Broadcast to all followers
  });

  socket.on('followerTimeReq', () => { // Follower asks for time update
    if (!users.hasOwnProperty(userId)) {
      socket.emit("displayError", 'Disconnected.');
      console.log('A socket sent a message, but is now disconnected.');
      return;
    }
    if (!leaderId) {
      socket.emit("displayError", 'There is no leader.');
      console.log(`The socket ${userId} attempted to request a time when there was no leader.`);
      return;
    }
    if (userId == leaderId) {
      socket.emit("displayError", 'You cannot request a time update as the leader.');
      console.log(`Leader ${userId} attempted to request a time update as the leader.`);
      return;
    }
    users[leaderId].socket.emit('leaderTimeReq', (data) => { // Leader sends through callback
      // TODO : VALIDATE DATA
      socket.emit('timeUpdate', data); // Send time back to follower
    });
  });

  socket.on('disconnect', function() {
    if (!users.hasOwnProperty(userId)) {
      console.log('A socket sent a message, but is now disconnected.');
      return;
    }
    if (userId == leaderId) leaderId = null;
    delete users[userId];
    console.log(`User ${userId} disconnected.`);
  });
});


