import {tagMessageReceipt} from "./cluster-fx.lib";

const os = require('os');
var WebSocketClient = require('websocket').client
import {v4 as uuidv4} from 'uuid';

var spawn = require('child_process').spawn;
const fs = require("fs");

const env_path = process.env.CLUSTER_FX_ENV || "./edge.env";
const WRITE_TO_DISK = process.env.CLUSTER_FX_WRITE || false;

require('dotenv').config({path: env_path});

let env = fs.readFileSync(env_path).toString();

if (env.indexOf(`CLUSTER_FX_EDGE_ID=""`) != -1) {
    let ID = uuidv4();
    env = env.replace(`CLUSTER_FX_EDGE_ID=""`, `CLUSTER_FX_EDGE_ID="${ID}"`);
    WRITE_TO_DISK ? fs.writeFileSync(env_path, env) : 0;
    process.env.CLUSTER_FX_EDGE_ID = ID;
    console.log(`cluster-fx set CLUSTER_FX_EDGE_ID ${ID}`);
}

if (env.indexOf(`CLUSTER_FX_EDGE_NAME=""`) != -1) {
    let NAME = uuidv4();
    env = env.replace(`CLUSTER_FX_EDGE_NAME=""`, `CLUSTER_FX_EDGE_NAME="${NAME}"`);
    WRITE_TO_DISK ? fs.writeFileSync(env_path, env) : 0;
    process.env.CLUSTER_FX_EDGE_NAME = NAME;
    console.log(`cluster-fx set CLUSTER_FX_EDGE_NAME ${NAME}`);
}

let sockets_to_gateway: typeof WebSocketClient[] = [];

function edgeInfo() {
    return {
        type: 3,
        last_ping: Date.now(),
        edge_id: process.env.CLUSTER_FX_EDGE_ID,
        edge_name: process.env.CLUSTER_FX_EDGE_NAME,
        cluster_id: process.env.CLUSTER_FX_CLUSTER_ID,
        arch: os.arch(),
        platform: os.platform(),
        hostname: os.hostname(),
        user: null,//os.userInfo(),
        uptime: Date.now(),
        loadavg:os.loadavg().concat(os.cpus().length) //os.cpus()
    }
}

let d_cache: any = [];

function ipDistance(a: string, b: string) {
    if (d_cache[a + b]) {
        return d_cache[a + b];
    }
    let _a = a.split(".").map((o, index) => {
        let i = (parseInt(o));
        i = Math.abs(i);
        let s = ("00" + i.toString());
        return ("00" + i.toString()).slice(s.length - 3, s.length)
    });
    let _b = b.split(".").map((o, index) => {
        let i = (parseInt(o));
        i = Math.abs(i);
        let s = ("00" + i.toString());
        return ("00" + i.toString()).slice(s.length - 3, s.length)
    });

    let __a = parseInt(_a.join(""));
    let __b = parseInt(_b.join(""));
    d_cache[a + b] = Math.abs(__a - __b);

    return d_cache[a + b];

}

function generateIPSpace() {
    let ips: any[] = [];

    let masks: any[] = [];
    if (process.env.GATEWAY_IP_MASK) {
        masks.push(process.env.GATEWAY_IP_MASK);
    }

    let est_ip: string = '0.0.0.0';


    function m(arr: string[]) {
        arr.forEach((ip: string) => {
            if (est_ip === '0.0.0.0') {
                est_ip = ip;
            }
            let parts = ip.split(".");
            let mask = `${parts[0]}.${parts[1]}`;
            if (masks.indexOf(mask) == -1) {
                masks.push(mask)
            }
        });
    }


    if (results) {
        if (results.en0) {
            m(results.en0);
        }
        if (results.en7) {
            m(results.en7);
        }

        if (results.bridge100) {
            m(results.bridge100);
        }
        if (results.wlan0) {
            m(results.wlan0);
        }

        if (masks.length === 0) {
            console.error('NO NETWORK INTERFACEs identified');
        }
    }

    console.log('masks', masks);

    masks.forEach((mask: string) => {
        let network = mask.split(".")[0];
        let order = mask.split(".")[1];
        //for (let order = 0; order <= 255; order++) {
        //     console.log('order done.', order);
        for (let upper = 0; upper <= 255; upper++) {
            for (let lower = 0; lower <= 255; lower++) {

                const uri = `${network}.${order}.${upper}.${lower}`;
                //if (ips.indexOf(uri) === -1) {
                ips.push(uri);
                // }
            }
        }
        // }
    })

    ips.sort((a: string, b: string) => {
        return (ipDistance(a, est_ip) - ipDistance(b, est_ip));
    });

    return ips;
}

const {networkInterfaces} = require('os');

const nets = networkInterfaces();
const results = Object.create(null); // Or just '{}', an empty object

for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
            if (!results[name]) {
                results[name] = [];
            }
            results[name].push(net.address);
        }
    }
}


async function dns() {

    let ips = generateIPSpace();
    console.log('generated ip check space', 'size:', ips.length, ips.slice(0, 10));

    while (ips.length > 0) {


        let p = () => {
            const uri = ips.shift();

            return new Promise(async (resolve, reject) => {

                //  const uri = [process.env.GATEWAY_IP_MASK, upper, lower].join(".");
                console.log("scanning", uri + `:${process.env.GATEWAY_PORT}`);

                let ping: any = true;
                try {
                    ping = await pingHost(uri);
                    console.log('ping result', ping);
                } catch (e) {
                    console.log(e);
                }

                if (!ping) {
                    resolve(false);
                    return;
                }


                let socket = new WebSocketClient();

                let ast = setTimeout(() => {
                    socket.abort();
                    //console.log(',PROBABLY NOT HERE');
                    resolve(
                        false);
                }, 10000);

                socket.on('connect', function (connection: any) {
                    console.log('WebSocket Client Connected');
                    uri;

                    clearTimeout(ast);

                    connection.on('error', function (error: any) {
                        console.log("Connection Error: " + error.toString());
                        resolve(false);
                    });
                    connection.on('close', function () {
                        console.log('echo-protocol Connection Closed');
                        resolve(false);
                    });

                    if (connection.connected) {
                        let info = edgeInfo();
                        connection.sendUTF(JSON.stringify({register: {edge: info}}));
                    }

                    connection.on('message', function (message: any) {
                        if (message.type === 'utf8') {
                            //   console.log("Received: '" + message.utf8Data + "'");
                            let j;
                            try {
                                j = JSON.parse(message.utf8Data);
                                if (j.daemon) {
                                    resolve(uri);
                                    socket.abort();

                                }
                            } catch (e) {
                                console.error(e);
                                resolve(false);
                            }


                        }

                    });
                });

                let s = socket.connect("ws://" + uri + `:${process.env.GATEWAY_PORT}`);

                console.log('SOCKET', s);
            });

        };

        let uri = await p();

        if (uri && typeof uri == "string") {

            const source = uri;
            let str = `${source} gateway`;

            try {
                let hosts = fs.readFileSync("/etc/hosts").toString();


                if (hosts.indexOf(str) == -1) {
                    WRITE_TO_DISK ? fs.writeFileSync('/etc/backup.hosts' + (Date.now()), hosts) : 0;
                    hosts += `
${str}`;
                    console.log('cluster-fx update /etc/hosts');
                    WRITE_TO_DISK ? fs.writeFileSync('/etc/hosts', hosts) : 0;

                }
            } catch (e) {
                console.log('unable to write /etc/hosts');
            }
            if (env.indexOf(`GATEWAY_IP=""`) != -1) {
                env = env.replace(`GATEWAY_IP=""`, `GATEWAY_IP="${uri}"`);

                WRITE_TO_DISK ? fs.writeFileSync(env_path, env) : 0;
                process.env.GATEWAY_IP = uri;
                console.log(`cluster-fx set GATEWAY_IP ${uri}`);
            }

            return uri;

        }


    }

    process.exit(1);

}


async function ttfb() {

    let time = Date.now();

    let p = () => {
        return new Promise((resolve) => {
            console.log("requesting", process.env.GATEWAY_IP + `:${process.env.GATEWAY_PORT}`);
            let socket = new WebSocketClient();


            let ast = setTimeout(() => {
                socket.abort();

                env = env.replace(`GATEWAY_IP="${process.env.GATEWAY_IP}"`, `GATEWAY_IP=""`);
                WRITE_TO_DISK ? fs.writeFileSync(env_path, env) : 0;
                process.env.GATEWAY_IP = "";
                console.log(`cluster-fx delete GATEWAY_IP`);

                resolve(-1);
            }, 30000);

            socket.on('connect', function (connection: any) {
                console.log('WebSocket Client Connected');

                clearTimeout(ast);

                connection.on('error', function (error: any) {
                    console.log("Connection Error: " + error.toString());
                    process.exit(1);
                    resolve(-1);
                });
                connection.on('close', function () {
                    console.log('echo-protocol Connection Closed');
                    process.exit(1);
                    resolve(-1);
                });

                if (connection.connected) {
                    let info = edgeInfo();
                    connection.sendUTF(JSON.stringify({register: {edge: info}}));


                    setInterval(() => {
                        connection.sendUTF(JSON.stringify({pong: process.env.CLUSTER_FX_EDGE_ID}));
                    }, 20 * 1000);

                }

                connection.on('message', function (message: any) {
                    if (message.type === 'utf8') {
                        //  console.log("Received: '" + message.utf8Data + "'");
                        try {
                            let msg = JSON.parse(message.utf8Data);
                            if (msg.utf8Data) {
                                msg = JSON.parse(msg.utf8Data);
                                //  console.log('WHY UTF DATA SO SEEP?', msg);
                            }
                            // console.log('data1', message, msg);
                            if (msg.daemon) {
                                resolve(Date.now());


                                if (msg.daemon.info) {
                                    if (env.indexOf(`CLUSTER_FX_CLUSTER_ID=""`) != -1) {
                                        let NAME = msg.daemon.info.cluster_id;
                                        env = env.replace(`CLUSTER_FX_CLUSTER_ID=""`, `CLUSTER_FX_CLUSTER_ID="${NAME}"`);
                                        WRITE_TO_DISK ? fs.writeFileSync(env_path, env) : 0;
                                        process.env.CLUSTER_FX_CLUSTER_ID = NAME;
                                        console.log(`cluster-fx set CLUSTER_FX_CLUSTER_ID ${NAME}`);
                                    }
                                }
                            }

                            if (msg.broadcast) { // RECEIVED BROADCAST FROM GATEWAY

                                let dat = {analytics: {trackback: tagMessageReceipt(3, msg).trackback}};
                                setTimeout(() => {
                                    connection.sendUTF(JSON.stringify(dat));
                                }, Math.floor(100 + (Math.random() * 2000)));

                            }

                        } catch (e) {
                            console.error(e);
                            resolve(-1);
                        }


                    }

                });
            });

            socket.connect("ws://" + process.env.GATEWAY_IP + `:${process.env.GATEWAY_PORT}`, 'echo-protocol');
        })
    }
    let t = await p();
    if (t !== -1) {
        console.log('cluster-fx gateway ttfb', `${(<number>t) - time}ms`);
        // process.exit(0);
    } else {
        console.log('cluster-fx gateway connection failure, should retry', process.env.GATEWAY_IP + `:${process.env.GATEWAY_PORT}`);
        process.exit(1);
    }
}


async function pingHost(host: string) {
//kick off process of listing files
    return new Promise((resolve) => {
        var child = spawn('ping', [host]);

        function kill() {
            child.stdin.pause();
            child.kill();
        }

//spit stdout to screen
        child.stdout.on('data', function (data: any) {

            // process.stdout.write("d:",data.toString());


            if (data.indexOf('Host is down') !== -1 || data.indexOf('Request timeout') !== -1 || data.indexOf('Destination Host Unreachable') !== -1) {
                console.log('HOST IS DOWN KILL');
                resolve(false);
                kill();
            }

            if (data.indexOf(`bytes from ${host}:`) !== -1 || data.indexOf(`From ${host} icmp_seq`) !== -1) {
                console.log('HOST IS DOWN KILL');
                resolve(true);
                kill();
            }

        });

//spit stderr to screen
        child.stderr.on('data', function (data: any) {
            //resolve(false);
            process.stdout.write("ERR", data.toString());
            // kill();
        });

        child.on('close', function (code: any) {
            resolve(false);
            //  console.log("Finished with code " + code);
            kill();
        });
    });

}

if (process.env.GATEWAY_IP === "") {
    (async () => {
        await dns();
        await ttfb();
    })()

} else {
    console.log(`cluster-fx service discovery complete`);
    console.log(`cluster-fx gateway located at ${process.env.GATEWAY_IP}:${process.env.GATEWAY_PORT}`);
    ttfb();
}


process.on('SIGTERM', () => {
    console.info('cluster-fx SIGTERM signal received.');
    sockets_to_gateway.forEach((socket) => {
        socket.abort();
    })
    process.exit(0);
});

