// Local network IP address discovery

import { networkInterfaces } from "node:os";

export function getLocalIPs(): ReadonlyArray<string> {
    const nets = networkInterfaces();
    const results: string[] = [];

    for (const name in nets) {
        const interfaces = nets[name];
        if (interfaces === undefined) continue;

        for (const iface of interfaces) {
            // Filter IPv4, external (non-internal) addresses
            if (iface.family === "IPv4" && !iface.internal) {
                results.push(iface.address);
            }
        }
    }

    return results;
}

export function getPreferredLocalIP(): string {
    const ips = getLocalIPs();
    // Prefer 192.168.x.x, otherwise return first address
    const preferred = ips.find((ip) => ip.startsWith("192.168."));
    if (preferred !== undefined) return preferred;
    if (ips.length > 0) return ips[0]!;
    return "127.0.0.1";
}
