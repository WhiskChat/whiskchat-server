// WhiskChat Server! :D

var io = require('socket.io').listen(Number(process.env.PORT));
var redis = require('redis');
var sockets = [];
// For Heroku:
io.configure(function () { 
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10); 
});
console.log('info - WhiskChat Server starting');
console.log('info - Starting DB');
if (process.env.REDISTOGO_URL) {
    var rtg   = require("url").parse(process.env.REDISTOGO_URL);
    var db = redis.createClient(rtg.port, rtg.hostname);
    
    db.auth(rtg.auth.split(":")[1]);
} else {
    var db = redis.createClient();
}
db.on('error', function(err) {
    console.log('error - DB error: ' + err);
});
db.on('ready', function() {
    console.log('info - DB connected');
    io.sockets.on('connection', function(socket) {
	sockets.push(socket);
	socket.on('disconnect', function() {
	    sockets.splice(sockets.indexOf(socket), 1);
	});
	socket.emit('joinroom', {room: 'main'});
        socket.emit('chat', {room: 'main', message: '<strong>Welcome to WhiskChat Server!</strong>', user: '[server]', timestamp: Date.now()});
        socket.emit('chat', {room: 'main', message: 'WhiskChat uses code from <a href="coinchat.org">coinchat.org</a>, (c) 2013 admin@glados.cc', user: '[server]', timestamp: Date.now()});
        socket.emit('chat', {room: 'main', message: 'Please authenticate using the link at the top.', user: '[server]', timestamp: Date.now()});
	socket.authed = false;
	socket.on('accounts', function(data) {
	    // do some login stuff here
	});
	socket.on('chat', function(data) {
	    if (!socket.authed) {
                socket.emit('chat', {room: 'main', message: 'Please log in or register to chat!', user: '[server]', timestamp: Date.now()});
	    }
	});
    });
    console.log('info - listening');
}); 
