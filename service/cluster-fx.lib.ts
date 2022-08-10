import {v4 as uuidv4} from 'uuid';
import {client as WebSocketClient} from 'websocket';

export interface TypeDef {
    primary: string;
}

export class LazyDataStreamer {

    schemas: any = {};

    registerSchema(name: string, typedef: TypeDef) {
        this.schemas[name] = typedef;
    }
}

export function findInArray(arr: any[], prop: string, value?: any) {
    let found = undefined;
    arr.forEach((e) => {
        if (e[prop] !== undefined) {
            if (value !== undefined) {
                if (value === e[prop]) {
                    found = e;
                    return e;
                }
            } else {
                found = e;
                return e;
            }
        }
    })
    return found;
}

/**
 * Format bytes as human-readable text.
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export function humanFileSize(bytes, si = false, dp = 1) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


    return bytes.toFixed(dp) + ' ' + units[u];
}

export function findIndexInArray(arr: any[], prop: string, value?: any) {
    let found = -1;
    for (let i = 0; i < arr.length; i++) {
        let e = arr[i];
        if (e[prop] !== undefined) {
            if (value !== undefined) {
                if (value === e[prop]) {
                    found = i;
                    return i;
                }
            } else {
                found = i;
                return i;
            }
        }
    }
    return found;
}


export class EdgeDriver {
    registeredDevices: EdgeInfo[];
    listeners: any;
    trackbacks: TrackbackInfo[];

    constructor() {
        this.registeredDevices = [];
        this.listeners = {};
        this.trackbacks = [];
    }

    updateProperty(ei: any) {
        let e = findIndexInArray(this.registeredDevices, 'edge_id', ei.edge_id);
        if (e !== -1) {
            this.registeredDevices[e] = Object.assign(this.registeredDevices[e], ei);
        }
    }

    updateStats(ei: EdgeInfo, analytics: any) {

        let e = findIndexInArray(this.registeredDevices, 'edge_id', ei.edge_id);
        if (e !== -1) {

            this.registeredDevices[e] = Object.assign(this.registeredDevices[e], ei);

            if (analytics.transfer) {
                this.registeredDevices[e].transfer = analytics.transfer;
            }

        } else {
            this.registerDevice(ei);
        }
        this.publish('trackback', ei);
    }

    registerDevice(ei: EdgeInfo) {
        let e = findIndexInArray(this.registeredDevices, 'edge_id', ei.edge_id);
        if (e !== -1) {
            this.registeredDevices[e] = Object.assign(this.registeredDevices[e], ei);
        } else {
            console.log('REGISTERD DEVICE', ei);
            this.registeredDevices.push(ei);
        }
        this.publish('register', ei);
    }

    addTrackbacks(ti: TrackbackInfo[]) {

        ti.forEach((tti) => {
            let e = findIndexInArray(this.trackbacks, 'trackback_id', tti.trackback_id);
            if (e !== -1) {
                this.trackbacks[e] = Object.assign(this.trackbacks[e], tti);
            } else {
                this.trackbacks.push(tti);
            }
        })

    }

    getGateways(): EdgeInfo[] {
        return this.registeredDevices.filter((device: EdgeInfo) => {
            return device.type === EdgeInfoType.GATEWAY;
        });
    }

    getDevices(): EdgeInfo[] {
        return this.registeredDevices;
    }

    getDevicesSimple(): EdgeInfo[] {
        return this.registeredDevices.map((d) => {
            let ob = Object.assign(d, {});
            delete ob.trackbacks;
            return ob;
        });
    }

    getTrackbacks(offset = 0, size = 1000) {

        return this.trackbacks.slice(offset, offset + size);
    }

    on(event: string, fn: any) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(fn);
    }

    publish(event: string, data: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach((e: any) => {
                e(data);
            });
        }
    }

}

export enum EdgeInfoType {
    UNASSIGNED = 0,
    DAEMON = 1,
    GATEWAY = 2,
    EDGE = 3
}

export function byteLength(str: string) {
    // returns the byte length of an utf8 string
    var s = str.length;
    for (var i = str.length - 1; i >= 0; i--) {
        var code = str.charCodeAt(i);
        if (code > 0x7f && code <= 0x7ff) s++;
        else if (code > 0x7ff && code <= 0xffff) s += 2;
        if (code >= 0xDC00 && code <= 0xDFFF) i--; //trail surrogate
    }
    return s;
}

interface SubscribeInterface {
    subscribe(identifier: string, callback: any): void;

    publish(identifier: string, data?: any): void;
}

class Subscribe implements SubscribeInterface {

    private _subscribers: any[];

    constructor() {
        this._subscribers = [];
    }

    getSubscribers(identifier: string): any {
        if (!this._subscribers[identifier]) {
            this._subscribers[identifier] = [];
        }
        return this._subscribers[identifier];
    }

    subscribe(identifier: string, callback: any): any {
        if (!this._subscribers[identifier]) {
            this._subscribers[identifier] = [];
        }
        this._subscribers[identifier].push(callback);
    }

    publish(identifier: string, data?: string): any {
        if (this._subscribers[identifier]) {
            this._subscribers[identifier].forEach(function (subscriber: any) {
                subscriber(data);
            });
        }
    }
}

export interface TransferStats {
    sent: number;
    received: number;
}

export class SocketClient {
    private _socket: any;
    private _subscribe: any;
    private _queue: any[] = []; // TODO SAVE BETWEEN LOCAL SESSIONS
    public connected: boolean;
    private loop: any;
    private endpoint: string = "";
    private connection: any;
    public transfer: TransferStats;

    constructor() {
        this._subscribe = new Subscribe();
        this.connected = false;
        this.loop = setInterval(() => {
            this.healthcheck()
        }, 3250);
        this.transfer = {
            sent: 0,
            received: 0
        }
    }

    isConnected() {
        return this.connected;
    }

    healthcheck() {
        if (!this.endpoint) {
            return
        }
        // console.log('healthcheck', this.connected);
        if (!this.connected) {
            console.info('Not connected to server, attemping', this.connected, !!this._socket);
            // TODO Check if we even are on wifi or cellular before continuing

            this.connect(this.endpoint);

        } else {
            this.send({
                ping: true
            });
        }

    }

    send(data: any) {
        if (this.connected) {
            try {
                let s = JSON.stringify(data);
                this.connection.sendUTF(s);
                this.transfer.sent += byteLength(s);
            } catch (e) {
                console.error('FAILED TO SEND', data, e);
                this.connected = false;
                this.publish('disconnect', e);
            }
        } else {
            console.log('NOT CONNECTED TO SOCKET SERVER YET.. QUEUEING', data);
            this._queue.push(data);
        }
    }

    connect(endpoint: string): any {

        if (this._socket) {
            this._socket.abort();
        }
        this.endpoint = endpoint;
        this._socket = new WebSocketClient();

        this._socket.on('connect', (connection: any) => {

            this.connected = true;
            this.connection = connection;

            connection.sendUTF(JSON.stringify({
                handshake: true
            }));

            this._queue.forEach((data) => {
                this.send(data);
            });
            this._queue = [];
            this.publish('connect', {});

            console.log('CONNECTED TO SOCKET THING', endpoint);

            connection.on('error', (error: any) => {
                console.log("Connection Error: " + error.toString());

                if (this.connected) {
                    this.publish('disconnect', error);
                }
                this.connected = false;
            });
            connection.on('close', () => {
                console.log('echo-protocol Connection Closed');

                if (this.connected) {
                    this.publish('disconnect', {});
                }
                this.connected = false;
            });

            connection.on('message', (message: any) => {
                // console.log('MESSAGE', message);
                if (message.type === 'utf8') {
                    //console.log("Received: '" + message.utf8Data + "'");
                    this.transfer.received += byteLength(message.utf8Data);
                    let json;
                    try {
                        json = JSON.parse(message.utf8Data);
                        for (var key in json) {
                            if (json.hasOwnProperty(key)) {
                                //let data = json[key];
                                this._subscribe.publish(key, json);
                            }
                        }
                        // _socket.publish(JSON.parse(e.data), this);
                    } catch (e) {
                        console.error('unable to parse message');
                        // process.exit(0);
                    }


                }
            });
        });

        this._socket.connect(endpoint, []);

    }

    subscribe(slug: string, fn: any): any {
        this._subscribe.subscribe(slug, fn);
    }

    publish(packet: string, data: any) {
        this._subscribe.publish(packet, data);
    }
}


export class SocketClientSession {
    ws: any;
    req: any;
    errs: any;
    uuid: any;
    reference?: EdgeIdentifier;

    constructor(ws: any, req: any) {
        this.errs = 0;
        this.ws = ws;
        this.req = req;
        this.uuid = uuidv4();
        this.reference = {type: 0};
    }
}

export interface DaemonInfo {
    daemon_id: string;
    cluster_id: string;
    cluster_name: string;
    uptime: number
}

export interface TrackbackInfo {
    trackback_id: string;
    routes: any[];
}

export const EdgeInfoTypeName = {
    0: "Unassigned",
    1: "Daemon",
    2: "Gateway",
    3: "Edge",
}


export interface EdgeInfo extends EdgeIdentifier {
    loadavg?: number[],
    transfer?: {
        received: number,
        sent: number
    };
    type: EdgeInfoType;
    edge_name: string;
    edge_id: string;
    cluster_id?: string;
    arch: string;
    platform: string;
    hostname: string;
    user: any;
    last_ping: number;
    uptime?: number;
    trackbacks?: any[];
}

export interface EdgeIdentifier {

    edge_name?: string,
    edge_id?: string,
    gui_name?: string,
    gui_id?: string,
    type: number,
    time_of_flight?: number
}

export function tagMessageReceipt(type: number, source: any) {
    let ob = Object.assign(source, {});
    if (!ob.trackback) {
        ob.trackback = [];
    }
    ob.trackback.push({
        type: type,
        time_of_flight: Date.now(),
        //gateway_name:process.env.CLUSTER_FX_GATEWAY_NAME,
        //gateway_id:process.env.CLUSTER_FX_GATEWAY_ID,
        edge_name: process.env.CLUSTER_FX_EDGE_NAME,
        edge_id: process.env.CLUSTER_FX_EDGE_ID
    });
    return ob;
}

export class SocketClientsManager {
    clients: any;

    constructor() {
        this.clients = {};
    }

    add(ws: any, req: any) {
        let session = new SocketClientSession(ws, req);
        this.clients[session.uuid] = session;
        return session;
    }

    getClients() {
        return this.clients;
    }

    broadcast(msg: any, not: string[] = []) {

        for (const uuid in this.clients) {
            if (not.indexOf(uuid) !== -1) {
                //console.log('EXCEPT THE PERSON WHO REQUESTED IT');
                continue
            }
            // console.log('BROADCASTING MESSAGE TO ', uuid, msg);
            try {
                // if ()
                this.clients[uuid].ws.send(JSON.stringify(msg));
            } catch (e) {
                // console.error(e);
                this.clients[uuid].errs++;
                if (this.clients[uuid].errs > 8) {
                    delete this.clients[uuid];
                }
            }
        }
    }
}
