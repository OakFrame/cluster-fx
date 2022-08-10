const process = require('process');
import {v4 as uuidv4} from 'uuid';
import {DaemonInfo, EdgeDriver, SocketClientsManager, tagMessageReceipt} from "./cluster-fx.lib";

export const ejs = require('ejs');

let ejsHelpers = {};

export const edgeDriver = new EdgeDriver();

require('dotenv').config({path: "daemon.env"});
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const PORT = parseInt(process.env.PORT) || 80;


let DAEMON_INFO: DaemonInfo = {
    cluster_name: process.env.CLUSTER_FX_CLUSTER_NAME,
    cluster_id: process.env.CLUSTER_FX_CLUSTER_ID,
    daemon_id: (process.env.CLUSTER_FX_DAEMON_ID) || uuidv4(),
    uptime: Date.now()
};


const app = express();
require('express-ws')(app);
app.set('views', __dirname + '/view');
app.set('view engine', 'ejs');
app.use(express.static(`../client/dist`));

app.use(require('cookie-parser')());
app.use(require('body-parser').urlencoded({extended: true}));
app.use(require('cookie-session')({secret: process.env.sessionSecret, resave: true, saveUninitialized: true}));

app.use(cors());
app.use(bodyParser.json());

app.use(function (req, res, next) {
    res.locals.environment = process.env.environment || "development";
    res.locals.helpers = ejsHelpers;
    next();
});

let socketClientsManager = new SocketClientsManager();

app.ws('*', function (ws, req) { //route for checking user login

    let socket = socketClientsManager.add(ws, req);

    ws.on('message', async (msg) => {

        msg = JSON.parse(msg);

        if (msg.broadcast) {
            msg = tagMessageReceipt(1, msg);
            socketClientsManager.broadcast(msg, [socket.uuid]);
        }

        if (msg.analytics) {
            if (!msg.analytics.data){
                return
            }
            edgeDriver.updateStats(msg.analytics.edge, msg.analytics.data);

            if (msg.analytics.data.trackbacks) {
                edgeDriver.addTrackbacks(msg.analytics.data.trackbacks);
            }
        }

        if (msg.register) {
            if (msg.register.edge) {
                edgeDriver.registerDevice(msg.register.edge);
            }
        }

        if (msg.daemon) {
            if (msg.daemon.info) {
                ws.send(JSON.stringify({
                    daemon: {info: DAEMON_INFO}
                }));
            }

            if (msg.daemon.devices) {
                ws.send(JSON.stringify({
                    daemon: {devices: edgeDriver.getDevicesSimple()}
                }));
            }

            if (msg.daemon.trackbacks) {
                ws.send(JSON.stringify({
                    daemon: {trackbacks: edgeDriver.getTrackbacks(msg.daemon.trackbacks.offset, msg.daemon.trackbacks.size)}
                }));
            }
        }

    });

});

const server = app.listen(PORT, () => {
    console.log(`Cluster-FX Daemon up on port ${PORT}`);
});
