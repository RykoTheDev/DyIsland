// Network status: local IP, whether the internet answers (and how fast), and whether a VPN adapter is up.
//   ping  = how long a TCP connection to `host`:443 takes (no ping.exe, no admin rights, works through firewalls that drop ICMP)
//   VPN   = an adapter that is up with an IPv4 address and whose name looks like a VPN client. A name match is a guess: a VPN with an unusual
//           adapter name is missed, and virtual-machine switches (Hyper-V, VMware, VirtualBox, WSL) are never counted.
const os = require('os');
const net = require('net');

const VPN_NAME = /(vpn|wireguard|wintun|\btun\d|\btap\b|tap-windows|openvpn|nordlynx|nord|proton|mullvad|tailscale|zerotier|anyconnect|cisco|fortinet|forticlient|globalprotect|pangp|surfshark|expressvpn|windscribe|cloudflare warp|warp)/i;
const VIRTUAL = /(vethernet|vmware|virtualbox|vbox|hyper-v|wsl|docker|loopback|bluetooth|pseudo)/i;

function parseIfaces(ifaces) {
  const list = [];
  for (const [name, addrs] of Object.entries(ifaces || {})) for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) list.push({ name, ip: a.address });
  const vpn = list.find((x) => VPN_NAME.test(x.name) && !VIRTUAL.test(x.name));
  const real = list.filter((x) => !VIRTUAL.test(x.name) && !(vpn && x.name === vpn.name));
  return { ip: (real[0] || list[0] || {}).ip || '', vpn: !!vpn, vpnName: vpn ? vpn.name.slice(0, 40) : '' };
}

function tcpPing(host, port = 443, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint(); let done = false;
    const fin = (v) => { if (!done) { done = true; try { s.destroy(); } catch { /* closed */ } resolve(v); } };
    const s = net.connect({ host, port });
    s.setTimeout(timeoutMs, () => fin(null));
    s.on('connect', () => fin(Math.max(1, Math.round(Number(process.hrtime.bigint() - t0) / 1e6))));
    s.on('error', () => fin(null));
  });
}

function create({ store, onStatus = () => {}, onVpnChange = () => {}, intervalMs = 10000, ping = tcpPing, ifaces = () => os.networkInterfaces() }) {
  let timer = null, busy = false, cur = { online: false, ip: '', vpn: false, vpnName: '', pingMs: null, host: '' }, first = true;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const c = store.get().network, p = parseIfaces(ifaces()), ms = p.ip ? await ping(c.host) : null;
      const next = { online: ms != null, ip: p.ip, vpn: p.vpn, vpnName: p.vpnName, pingMs: ms, host: c.host };
      if (!timer) return;                                 // switched off while we were measuring
      const vpnChanged = !first && next.vpn !== cur.vpn;
      first = false; cur = next; onStatus(next);
      if (vpnChanged && c.vpnAlerts) onVpnChange(next);
    } finally { busy = false; }
  }
  return {
    start() { if (!timer) { first = true; timer = setInterval(tick, intervalMs); tick(); } },
    stop() { clearInterval(timer); timer = null; },
    status: () => cur, _tick: tick,
  };
}

module.exports = { create, parseIfaces, tcpPing, VPN_NAME };
