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
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status, results })));
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
    respond([result(), { ...result(), geometry: { ...result().geometry, location: { lat: 44.82, lng: 20.47 } } }]);
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

  it.each([
    ["REQUEST_DENIED", "proveri API ključ, dozvole i naplatu"],
    ["OVER_QUERY_LIMIT", "proveri kvotu i naplatu"],
    ["UNKNOWN_ERROR", "Pokušajte ponovo"],
  ])("handles provider status %s without exposing the response", async (status, explanation) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status, error_message: "private-test-key" })));
    await expect(geocodePickupAddress(address)).rejects.toThrow(explanation);
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


describe("pickup error explanations", () => {
  beforeEach(() => { vi.stubEnv("GOOGLE_MAPS_API_KEY", "private-test-key"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("shows the entered and returned street and the corrective action", async () => {
    const item = result(); item.address_components[0].long_name = "Ištvana Berte";
    respond([item]);
    await expect(geocodePickupAddress({...address, shipStreet: "Berta Istvan (5)"})).rejects.toThrow(
      "U porudžbini je ulica „Berta Istvan“, a Google Maps je pronašao „Ištvana Berte“.");
  });
  it("distinguishes a mismatched house number from a street error", async () => {
    const item = result(); item.address_components[1].long_name = "6"; respond([item]);
    await expect(geocodePickupAddress(address)).rejects.toThrow("Unet je kućni broj „5“, a Google Maps je pronašao „6“.");
  });
  it("explains insufficient precision even when every address field matches", async () => {
    const item = result(); item.geometry.location_type = "RANGE_INTERPOLATED"; respond([item]);
    await expect(geocodePickupAddress(address)).rejects.toThrow("nije potvrdio tačnu lokaciju objekta");
  });
  it("explains ambiguity and absent Google results separately", async () => {
    respond([result(), { ...result(), geometry: { ...result().geometry, location: { lat: 44.82, lng: 20.47 } } }]);
    await expect(geocodePickupAddress(address)).rejects.toThrow("više mogućih lokacija");
    respond([], "ZERO_RESULTS");
    await expect(geocodePickupAddress(address)).rejects.toThrow("nije pronašao adresu „Vladetina 5, Beograd“");
  });
});

 describe("verified Senta street aliases", () => {
  beforeEach(() => { vi.stubEnv("GOOGLE_MAPS_API_KEY", "private-test-key"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function senta(route = "Ištvana Berte", number = "59", city = "Senta") {
    const item = result();
    for (const [index, name] of [[0, route], [1, number], [2, city]] as const) {
      item.address_components[index].long_name = name; item.address_components[index].short_name = name;
    }
    return item;
  }
  it.each(["Berta Istvan", "Berta Ištvana", "Ištvana Berte", "Ištvana Berta"])("accepts the same street as %s without changing the order", async (route) => {
    const input = { shipStreet: "Berta Istvan (59)", shipHouseNumber: "59", shipCity: "Senta" };
    respond([senta(route)]);
    await expect(geocodePickupAddress(input)).resolves.toEqual({ latitude: 44.81, longitude: 20.46 });
    expect(fetchMock.mock.calls[0][0].searchParams.get("address")).toBe("Berta Istvan 59, Senta, Srbija");
    expect(input.shipStreet).toBe("Berta Istvan (59)");
  });
  it("retries the confirmed courier name when Google does not index the original", async () => {
    respond([senta()]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] })));
    await expect(geocodePickupAddress({ shipStreet: "Berta Istvan (59)", shipHouseNumber: "59", shipCity: "Senta" })).resolves.toEqual({ latitude: 44.81, longitude: 20.46 });
    expect(fetchMock.mock.calls.map(([url]) => url.searchParams.get("address"))).toEqual(["Berta Istvan 59, Senta, Srbija", "Ištvana Berte 59, Senta, Srbija"]);
  });
  it.each([senta("Ištvana Berte", "60"), senta("Ištvana Berte", "59", "Subotica"), senta("Druga ulica")])("still rejects another house, town or street", async (item) => {
    respond([item]);
    await expect(geocodePickupAddress({ shipStreet: "Berta Istvan (59)", shipHouseNumber: "59", shipCity: "Senta" })).rejects.toThrow(/nije pouzdano/);
  });
});

 describe("multiple Google suggestions", () => {
  beforeEach(() => { vi.stubEnv("GOOGLE_MAPS_API_KEY", "private-test-key"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("accepts the uniquely confirmed building while rejecting a different house suggestion", async () => {
    const wrong = result(); wrong.address_components[1].long_name = "6";
    respond([wrong, result()]);
    await expect(geocodePickupAddress(address)).resolves.toEqual({ latitude: 44.81, longitude: 20.46 });
  });
  it("treats duplicate exact coordinates as one building", async () => {
    respond([result(), result()]);
    await expect(geocodePickupAddress(address)).resolves.toEqual({ latitude: 44.81, longitude: 20.46 });
  });
  it("explains why none of the suggestions confirms the building", async () => {
    const approximate = result(); approximate.geometry.location_type = "RANGE_INTERPOLATED";
    respond([approximate, approximate]);
    await expect(geocodePickupAddress(address)).rejects.toThrow("nije potvrdio tačnu lokaciju objekta");
  });
});
