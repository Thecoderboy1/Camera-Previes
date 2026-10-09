export class SignalingChannel {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage: (msg: any) => void;
  private onConnect: () => void;
  private onDisconnect: () => void;

  constructor(url: string, onMessage: (msg: any) => void, onConnect: () => void, onDisconnect: () => void) {
    this.url = url;
    this.onMessage = onMessage;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.onConnect();
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };
    this.ws.onclose = () => {
      this.onDisconnect();
    };
    this.ws.onerror = (err) => {
      console.error('WS Error', err);
    };
  }

  send(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
