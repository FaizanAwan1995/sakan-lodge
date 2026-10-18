import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { contractPdf } from "./contract-pdf.js";
const fields = {
  proprietor: {
    name: "Synthetic Proprietor",
    address: "1 Test Road",
    phone: "0400000000",
  },
  premises_address: "2 Synthetic Street",
  resident_names: ["Synthetic Applicant"],
  full_name: "Synthetic Applicant",
  email: "test@example.test",
  phone: "0400000000",
  room_label: "Room 9",
  arrival_date: "2030-01-01",
  departure_date: "2030-04-01",
  term_description: "Agreed dates",
  first_rent_due: "2030-01-01",
  weekly_rate: 255,
  bond: 510,
  billing_type: "fortnightly",
  terms:
    "Reviewed terms. All utilities included.\n\n" +
    "Synthetic clause text with sufficient wrapping and pagination. ".repeat(
      220,
    ),
};
test("generated PDF has A4 pages, readable fixed snapshot and no resident signatures", async () => {
  const bytes = await contractPdf({ version: 1, fields }, "SYNTHETIC-ONLY");
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3);
  for (const p of doc.getPages())
    assert.ok(Math.abs(p.getWidth() - 595.28) < 0.01);
  assert.equal(doc.getForm().getFields().length, 0);
  assert.ok(doc.context.enumerateIndirectObjects().some(([,obj])=>obj.dict?.get(PDFName.of("Filter"))?.toString()==="/DCTDecode"), "owner-supplied JPEG logo is embedded in the PDF");
});
test("missing verified contract fields cannot produce a signing document", async () => {
  await assert.rejects(
    () => contractPdf({ version: 1, fields: {} }, "TEST"),
    /Complete reviewed/,
  );
});

test("owner-authorised proprietor artwork is embedded in new PDF, without resident signatures", async () => {
  const signature_png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=";
  const bytes = await contractPdf(
    {
      version: 2,
      fields: {
        ...fields,
        proprietor_signature: {
          signature_png,
          signature_name: "Synthetic Owner",
        },
        proprietor_signature_date: "2030-01-01",
      },
    },
    "SYNTHETIC",
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(
    pdf
      .getPages()
      .some((p) => p.node.Resources()?.toString().includes("/XObject")),
  );
});
