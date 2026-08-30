import { createServer } from "node:http";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
  for (let parcelIndex = 0; parcelIndex < parcels.length; parcelIndex += 1) {
    const parcel = parcels[parcelIndex];
    for (const property of parcel.ParcelPropertyList) {
      labelNo += 1;
      const page = document.addPage([420, 595]);
      page.drawRectangle({
        x: 18,
        y: 18,
        width: 384,
        height: 559,
        borderWidth: 1,
        borderColor: rgb(0, 0, 0),
      });
      page.drawText("MyGLS ISOLATED ACCEPTANCE LABEL", {
        x: 34,
        y: 545,
        size: 14,
        font,
      });
      page.drawText(`Reference: ${parcel.ClientReference}`, {
        x: 34,
        y: 510,
        size: 11,
        font,
      });
      page.drawText(`Parcel: ${printInfo[parcelIndex].ParcelNumberWithCheckdigit}`, {
        x: 34,
        y: 487,
        size: 11,
        font,
      });
      page.drawText(`Package ${labelNo} of ${totalPackages(parcels)}`, {
        x: 34,
        y: 464,
        size: 11,
        font,
      });
      page.drawText(
        `Dimensions: ${property.Width} x ${property.Length} x ${property.Height} cm`,
        { x: 34, y: 430, size: 10, font },
      );
      page.drawText(`Weight: ${property.Weight} kg`, {
        x: 34,
        y: 410,
        size: 10,
        font,
      });
    }
  }
  return Buffer.from(await document.save());
}

function totalPackages(parcels) {
  return parcels.reduce(
    (total, parcel) =>
      total + (Array.isArray(parcel.ParcelPropertyList)
        ? parcel.ParcelPropertyList.length
        : 0),
    0,
  );
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
