import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geocodePickupAddress } from "@/lib/address/google-geocoding";

const address = { shipStreet: "Vladetina (5)", shipHouseNumber: "5", shipCity: "Beograd (Vračar)" };
function result() {
  return {
    types: ["street_address"],
    address_components: [
      { long_name: "Владетина", short_name: "Владетина", types: ["route"] },
      { long_name: "5", short_name: "5", types: ["street_number"] },
      { long_name: "Београд", short_name: "БГ", types: ["locality"] },
      { long_name: "Србија", short_name: "RS", types: ["country"] },
    ],
    geometry: { location_type: "ROOFTOP", location: { lat: 44.81, lng: 20.46 } },
  };
}
const fetchMock = vi.fn();
function respond(results: unknown[] = [result()], status = "OK") {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status, results })));
}

describe("automatic customer pickup geocoding", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "private-test-key");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    respond();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("matches Serbian Cyrillic results to the complete Latin input and sends only the address", async () => {
    await expect(geocodePickupAddress(address)).resolves.toEqual({ latitude: 44.81, longitude: 20.46 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.searchParams.get("address")).toBe("Vladetina 5, Beograd, Srbija");
    expect(url.searchParams.get("components")).toBe("country:RS");
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["", "GET_FROM_GOOGLE_CONSOLE"])("rejects missing/placeholder keys before calling Google: %s", async (key) => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", key);
    await expect(geocodePickupAddress(address)).rejects.toThrow(/nije podešeno/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { shipStreet: "Vladetina", shipCity: "Beograd" },
    { shipStreet: "Vladetina bb", shipCity: "Beograd" },
    { shipStreet: "Vladetina 5", shipCity: "" },
    { shipStreet: "", shipHouseNumber: "5", shipCity: "Beograd" },
  ])("requires a usable street, house number and city: %j", async (input) => {
    await expect(geocodePickupAddress(input)).rejects.toThrow(/Proverite ulicu/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["APPROXIMATE", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"])("rejects %s points instead of guessing a pickup", async (precision) => {
    const item = result(); item.geometry.location_type = precision; respond([item]);
    await expect(geocodePickupAddress(address)).rejects.toThrow(/nije pouzdano/);
  });

  it("rejects partial matches and multiple candidates", async () => {
    respond([{ ...result(), partial_match: true }]);
    await expect(geocodePickupAddress(address)).rejects.toThrow(/nije pouzdano/);
    respond([result(), result()]);
    await expect(geocodePickupAddress(address)).rejects.toThrow(/nije pouzdano/);
  });

  it.each(["route", "street_number", "locality", "country"])("rejects a precise result with mismatched %s", async (type) => {
    const item = result();
    const component = item.address_components.find((c) => c.types.includes(type))!;
    component.long_name = "Wrong"; component.short_name = "Wrong";
    respond([item]);
    await expect(geocodePickupAddress(address)).rejects.toThrow(/nije pouzdano/);
  });

  it("does not collapse a house-number suffix to the neighboring building", async () => {
    await expect(geocodePickupAddress({ ...address, shipStreet: "Vladetina", shipHouseNumber: "5A" })).rejects.toThrow(/nije pouzdano/);
  });

  it.each([null, {}, { ...result(), geometry: { location_type: "ROOFTOP", location: { lat: 0, lng: 0 } } }])("rejects malformed or invalid coordinates", async (item) => {
    respond([item]);
    await expect(geocodePickupAddress(address)).rejects.toThrow(/nije pouzdano/);
  });

  it("reports no results as an address correction, not a configuration issue", async () => {
    respond([], "ZERO_RESULTS");
    await expect(geocodePickupAddress(address)).rejects.toThrow(/Proverite ulicu/);
  });

  it.each(["REQUEST_DENIED", "OVER_QUERY_LIMIT", "UNKNOWN_ERROR"])("handles provider status %s without exposing the response", async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status, error_message: "private-test-key" })));
    await expect(geocodePickupAddress(address)).rejects.toThrow(/proveri API ključ, naplatu i kvotu/);
  });

  it("sanitizes network/timeout failures, HTTP errors and invalid JSON", async () => {
    for (const failure of ["network", "http", "json"]) {
      if (failure === "network") fetchMock.mockRejectedValue(new Error("https://maps.googleapis.com/?key=private-test-key"));
      else fetchMock.mockResolvedValue(new Response("private-test-key", { status: failure === "http" ? 503 : 200 }));
      try { await geocodePickupAddress(address); throw new Error("Expected rejection"); }
      catch (error) {
        expect((error as Error).message).toMatch(/trenutno nije dostupan/);
        expect((error as Error).message).not.toContain("private-test-key");
      }
    }
  });
});
