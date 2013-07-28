// WhiskChat Server! :D

var io = require('socket.io').listen(Number(process.env.PORT));
var redis = require('redis');
var sockets = [];
var online = 0;
var lastSendOnline = new Date(); //throttle online requests

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
	online++;
	if(lastSendOnline.getTime() < new Date().getTime() - 2.5 * 1000){
		io.sockets.volatile.emit("onine", {people: online});
		lastSendOnline = new Date();
	} else {
		socket.emit("online", {people: online});
	}
	socket.on('disconnect', function() {
		sockets.splice(sockets.indexOf(socket), 1);
		online--;
	});
	socket.emit('joinroom', {room: 'main'});
	socket.emit('chat', {room: 'main', message: '<strong>Welcome to WhiskChat Server!</strong>', user: '[server]'});
        socket.emit('chat', {room: 'main', message: 'WhiskChat uses code from <a href="coinchat.org">coinchat.org</a>, (c) 2013 admin@glados.cc', user: '[server]'});
    });
    console.log('info - listening');
}); 
