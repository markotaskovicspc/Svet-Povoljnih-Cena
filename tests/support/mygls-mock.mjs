import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

const host = process.env.MYGLS_MOCK_HOST?.trim() || "127.0.0.1";
const requestedPort = Number(process.env.MYGLS_MOCK_PORT ?? "54323");
const port = Number.isInteger(requestedPort) && requestedPort > 0
  ? requestedPort
  : 54323;
const requests = [];
let nextParcelId = 7_100_000;
let nextParcelNumber = 1_100_000_000;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, requests: requests.length });
    }
    if (request.method === "GET" && url.pathname === "/requests") {
      return json(response, 200, { requests });
    }
    if (request.method === "DELETE" && url.pathname === "/requests") {
      requests.length = 0;
      return json(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/order/check-address") {
      const body = await readJson(request);
      requests.push({ method: "XExpressCheckAddress", body });
      return json(response, 200, { area: "QA-01" });
    }
    if (request.method === "POST" && url.pathname === "/api/order/add") {
      const body = await readJson(request);
      requests.push({ method: "XExpressCreateOrder", body });
      return json(response, 202, { requestGuid: randomUUID() });
    }

    const method = url.pathname.match(
      /^\/(ParcelService|MasterDataService)\.svc\/json\/([^/]+)$/,
    );
    if (request.method !== "POST" || !method) {
      return json(response, 404, { message: "Unsupported MyGLS mock route" });
    }

    const body = await readJson(request);
    const entry = {
      service: method[1],
      method: method[2],
      body,
      receivedAt: new Date().toISOString(),
    };
    requests.push(entry);

    if (method[2] === "PrintLabels") {
      return printLabels(response, entry);
    }
    if (method[2] === "DeleteLabels") {
      const parcelIds = Array.isArray(body.ParcelIdList)
        ? body.ParcelIdList.map(Number).filter(Number.isFinite)
        : [];
      return json(response, 200, {
        DeleteLabelsErrorList: [],
        SuccessfullyDeletedList: parcelIds.map((ParcelId) => ({
          ParcelId,
          SubParcelIdList: [],
        })),
      });
    }
    if (method[2] === "ModifyCOD") {
      return json(response, 200, {
        ModifyCODError: [],
        Successful: true,
      });
    }

    return json(response, 200, {});
  } catch (error) {
    return json(response, 500, {
      message: error instanceof Error ? error.message : "MyGLS mock failure",
    });
  }
});

server.listen(port, host, () => {
  console.log(`MyGLS mock ready at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function printLabels(response, entry) {
  const parcels = Array.isArray(entry.body.ParcelList)
    ? entry.body.ParcelList
    : [];
  if (!parcels.length) {
    return providerError(response, "MyGLS request has no parcels.");
  }

  for (const parcel of parcels) {
    if (!/^\/Date\(\d+\)\/$/.test(String(parcel.PickupDate ?? ""))) {
      return providerError(
        response,
        "PickupDate must use the ASP.NET /Date(milliseconds)/ format.",
      );
    }
    const properties = Array.isArray(parcel.ParcelPropertyList)
      ? parcel.ParcelPropertyList
      : [];
    if (Number(parcel.Count) !== properties.length || properties.length === 0) {
      return providerError(
        response,
        "Parcel Count must match ParcelPropertyList length.",
      );
    }
    for (const property of properties) {
      for (const key of ["Height", "Width", "Length"]) {
        const value = Number(property[key]);
        if (!Number.isInteger(value)) {
          return providerError(
            response,
            `There was an error deserializing the object of type GLS.MyGLS.ServiceData.APIDTOs.LabelOperations.PrintLabelsRequest. The value '${property[key]}' cannot be parsed as the type 'Int32'.`,
          );
        }
      }
      const weight = Number(property.Weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        return providerError(response, "Parcel weight must be a positive number.");
      }
    }
  }

  const printInfo = parcels.map((parcel) => ({
    ClientReference: String(parcel.ClientReference ?? "QA"),
    ParcelId: nextParcelId++,
    ParcelNumber: nextParcelNumber++,
    ParcelNumberWithCheckdigit: nextParcelNumber++,
  }));
  const labelPdf = await makeLabelPdf(parcels, printInfo);
  return json(response, 200, {
    Labels: labelPdf.toString("base64"),
    PrintLabelsErrorList: [],
    PrintLabelsInfoList: printInfo,
  });
}

function providerError(response, description) {
  return json(response, 200, {
    Labels: null,
    PrintLabelsInfoList: [],
    PrintLabelsErrorList: [
      { ErrorCode: 400, ErrorDescription: description },
    ],
  });
}

async function makeLabelPdf(parcels, printInfo) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  let labelNo = 0;
  const printable = value => String(value).replace(/đ/g, "dj").replace(/Đ/g, "Dj")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
  for (let parcelIndex = 0; parcelIndex < parcels.length; parcelIndex += 1) {
    const parcel = parcels[parcelIndex];
    for (const property of parcel.ParcelPropertyList) {
      // Match the verified A4_2x2 provider geometry used by the print pipeline.
      if (labelNo % 4 === 0) document.addPage([841.89, 595.276]);
      const page = document.getPage(document.getPageCount() - 1);
      const x = 199 + (labelNo % 2) * 398;
      const y = 389.0338 - Math.floor((labelNo % 4) / 2) * 300;
      page.drawText("Primalac:", { x, y: y + 163, size: 8, font });
      page.drawText("QA primalac", { x, y: y + 145, size: 11, font });
      page.drawText("Posiljalac:", { x: x + 63, y, size: 8, font });
      page.drawText("Svet povoljnih cena QA", { x: x + 63, y: y - 14, size: 8, font });
      page.drawText("Politika privatnosti", { x, y: y + 73.8106, size: 6, font });
      page.drawText(printable(property.Content), { x, y: y + 38.8106, size: 4, font });
      page.drawText(`Reference: ${parcel.ClientReference}`, { x: x - 170, y: y + 110, size: 7, font });
      page.drawText(`Parcel: ${printInfo[parcelIndex].ParcelNumberWithCheckdigit}`, { x: x - 170, y: y + 90, size: 9, font });
      labelNo += 1;
    }
  }
  return Buffer.from(await document.save());
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJson(request) {
  const body = await readBody(request);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}
