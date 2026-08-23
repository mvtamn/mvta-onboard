import test from "node:test";
import assert from "node:assert/strict";
import { classifyVehicleZone } from "./eventVehicleZone";

const contains = (polygon: string) => polygon === "inside";
const fence = (id: string, purpose?: string) => ({ id, name: id, polygon: "inside", purpose, is_active: true });

test("classifyVehicleZone uses authored purpose precedence", () => {
  assert.deepEqual(classifyVehicleZone({ latitude: 1, longitude: 1 }, [fence("corridor", "corridor"), fence("venue", "venue")], contains), { zone_id: "venue", zone_name: "venue", zone_purpose: "venue", zone_status: "At venue" });
});
test("classifyVehicleZone defaults legacy fences to other", () => assert.equal(classifyVehicleZone({ latitude: 1, longitude: 1 }, [fence("legacy")], contains).zone_status, "In zone"));
test("classifyVehicleZone gives custom purposes a safe generic status", () => assert.equal(classifyVehicleZone({ latitude: 1, longitude: 1 }, [fence("checkpoint", "checkpoint")], contains).zone_status, "In zone"));
test("classifyVehicleZone reports outside monitored zones and ignores inactive or malformed fences", () => assert.deepEqual(classifyVehicleZone({ latitude: 1, longitude: 1 }, [{ ...fence("inactive", "venue"), is_active: false }, { ...fence("bad", "venue"), polygon: "bad" }], contains), { zone_id: null, zone_name: null, zone_purpose: null, zone_status: "Outside monitored zones" }));
