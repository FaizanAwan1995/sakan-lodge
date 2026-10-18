import { contractLogoJpeg } from "./contract-logo.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const plain = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
export async function contractPdf(contract, code) {
  const f = contract.fields;
  if (
    !f?.proprietor?.name ||
    !f.premises_address ||
    !f.terms ||
    !f.resident_names?.length
  )
    throw Error("Complete reviewed contract details are required");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle("SAKAN Lodge agreement " + code);
  pdf.setAuthor("SAKAN Lodge");
  const navy = rgb(0.12, 0.2, 0.28),
    gold = rgb(0.56, 0.4, 0.18),
    pale = rgb(0.96, 0.95, 0.92);
  const logo = await pdf.embedJpg(Uint8Array.from(atob(contractLogoJpeg), c => c.charCodeAt(0)));
  let signature;
  if (f.proprietor_signature?.signature_png) {
    signature = await pdf.embedPng(
      Uint8Array.from(atob(f.proprietor_signature.signature_png), (c) =>
        c.charCodeAt(0),
      ),
    );
  }
  let page, y;
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 744,
      width: 595.28,
      height: 97,
      color: navy,
    });
    page.drawRectangle({ x: 0, y: 740, width: 595.28, height: 4, color: gold });
    page.drawImage(logo, {x:465,y:754,width:76,height:76});
    page.drawText("SAKAN", {
      x: 42,
      y: 798,
      font: bold,
      size: 25,
      color: rgb(1, 1, 1),
    });
    page.drawText("LODGE", {
      x: 145,
      y: 800,
      font: regular,
      size: 11,
      color: rgb(0.85, 0.76, 0.58),
    });
    page.drawText("ROOMING HOUSE AGREEMENT", {
      x: 42,
      y: 771,
      font: bold,
      size: 14,
      color: rgb(1, 1, 1),
    });
    page.drawText("SOUTH AUSTRALIA  /  Residential Tenancies Act 1995", {
      x: 42,
      y: 754,
      font: regular,
      size: 8,
      color: rgb(0.85, 0.88, 0.9),
    });
    y = 718;
    page.drawText(plain(code) + "  |  Agreement version " + contract.version, {
      x: 42,
      y,
      font: regular,
      size: 9,
      color: navy,
    });
    y -= 25;
  };
  newPage();
  function line(
    text,
    { heading = false, size = 10, x = 48, width = 499 } = {},
  ) {
    if (heading && y < 120) newPage();
    if (heading) {
      page.drawRectangle({
        x: 42,
        y: y - 7,
        width: 511,
        height: 25,
        color: pale,
      });
      page.drawRectangle({
        x: 42,
        y: y - 7,
        width: 3,
        height: 25,
        color: gold,
      });
      y -= 1;
    }
    const font = heading ? bold : regular;

    let words = plain(text).split(/\s+/),
      row = "";
    function draw() {
      if (y < 65) newPage();
      page.drawText(row, {
        x: heading ? 53 : x,
        y,
        size,
        font,
        color: rgb(0.12, 0.15, 0.13),
      });
      y -= size * 1.5;
      row = "";
    }
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > width) {
        if (row) draw();
        let part = "";
        for (const c of word) {
          if (font.widthOfTextAtSize(part + c, size) > width) break;
          part += c;
        }
        row = part;
        draw();
        word = word.slice(part.length);
      }
      if (font.widthOfTextAtSize((row ? row + " " : "") + word, size) > width)
        draw();
      row += (row ? " " : "") + word;
    }
    if (row) draw();
    y -= heading ? 14 : 6;
  }
  function detail(label, value) {
    if (y < 115) newPage();
    const top = y + 11;
    page.drawText(label, { x: 53, y, font: bold, size: 9, color: navy });
    line(value, { x: 185, width: 357, size: 10 });
    page.drawLine({
      start: { x: 48, y: y + 4 },
      end: { x: 547, y: y + 4 },
      thickness: 0.4,
      color: rgb(0.85, 0.85, 0.83),
    });
    y -= 8;
  }
  line("Parties and premises", { heading: true, size: 12 });
  for (const [label, value] of [
    ["Proprietor", f.proprietor.name],
    ["Proprietor address", f.proprietor.address],
    ["Proprietor contact", f.proprietor.phone],
    ["Resident(s)", f.resident_names.join("; ")],
    ["Contact", f.phone],
    ["Email", f.email],
    ["Room", f.room_label],
    ["Premises", f.premises_address],
  ])
    detail(label, value);
  line("Term, rent and bond", { heading: true, size: 12 });
  const money = (n) => "AUD $" + Number(n).toFixed(2);
  for (const [label, value] of [
    ["Arrival", f.arrival_date],
    ["Departure", f.departure_date],
    ["Agreement term", f.term_description],
    [
      "Rent",
      f.billing_type === "nightly"
        ? money(f.nightly_rate) + " per night per resident"
        : money(f.weekly_rate * 2) +
          " per fortnight" +
          (f.offer_type === "shared" ? " per resident" : "") +
          " (" +
          money(f.weekly_rate) +
          " per week)",
    ],
    ["First rent due", f.first_rent_due],
    ["Bond per resident", money(f.bond)],
    [
      "Payment",
      f.billing_type === "nightly"
        ? "Bond via PayID 0426721787. Remaining rent payable on arrival; agreed nightly rent applies."
        : "Bond via PayID 0426721787. Remaining rent payable on arrival. Subsequent rent fortnightly in advance.",
    ],
    [
      "Utilities",
      "Electricity, water, gas and internet included without additional charges.",
    ],
  ])
    detail(label, value);
  newPage();
  line("Terms and house rules", { heading: true, size: 12 });
  for (const para of f.terms.split(/\n\s*\n/)) {
    const match = para.match(/^(\d+\.[^\n]+)\n([\s\S]*)$/);
    if (match) {
      line(match[1], { heading: true, size: 10 });
      line(match[2]);
    } else line(para);
  }
  if (y < 300) newPage();
  line("Signatures", { heading: true, size: 12 });
  line(
    "Please read this agreement before signing. A copy must be provided to the resident.",
  );
  line(
    "Proprietor: " +
      (f.proprietor_signature?.signature_name || f.proprietor.name),
    { heading: true },
  );
  if (signature) {
    page.drawImage(signature, { x: 48, y: y - 68, width: 98, height: 79 });
    page.drawText("Authorised proprietor signature", {
      x: 170,
      y: y - 30,
      font: regular,
      size: 9,
    });
    page.drawText("Date: " + plain(f.proprietor_signature_date || ""), {
      x: 350,
      y: y - 30,
      font: regular,
      size: 9,
    });
    y -= 88;
  } else {
    line("Signature: ____________________________   Date: __________________");
  }
  for (const name of f.resident_names) {
    if (y < 170) newPage();
    line("Resident: " + name, { heading: true });
    y -= 30;
    line("Signature: ____________________________   Date: __________________");
    y -= 12;
  }
  if (y < 125) newPage();
  line("A COPY OF THIS AGREEMENT MUST BE GIVEN TO THE RESIDENT", {
    heading: true,
    size: 9,
  });
  line("Consumer and Business Services: 131 882 | sa.gov.au/renting", {
    size: 8,
  });
  line(
    "SAKAN agreement structured with reference to the CBS rooming house agreement (September 2025). SAKAN branding is independent of government.",
    { size: 7 },
  );
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: 42, y: 49 },
      end: { x: 553, y: 49 },
      thickness: 0.6,
      color: gold,
    });
    p.drawText("SAKAN Lodge | " + (i + 1) + " / " + pages.length, {
      x: 48,
      y: 32,
      font: regular,
      size: 8,
    });
  });
  return pdf.save();
}
