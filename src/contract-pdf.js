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
  let page, y;
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 775;
    page.drawText("SAKAN LODGE | ROOMING HOUSE AGREEMENT", {
      x: 48,
      y,
      font: bold,
      size: 13,
      color: rgb(0.1, 0.24, 0.18),
    });
    y -= 24;
    page.drawText(plain(code) + " | Version " + contract.version, {
      x: 48,
      y,
      font: regular,
      size: 9,
    });
    y -= 28;
  };
  newPage();
  function line(text, { heading = false, size = 10 } = {}) {
    if (heading && y < 110) newPage();
    const font = heading ? bold : regular;
    const width = 499;
    let words = plain(text).split(/\s+/),
      row = "";
    function draw() {
      if (y < 65) newPage();
      page.drawText(row, {
        x: 48,
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
    y -= 5;
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
    line(label + ": " + value);
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
    line(label + ": " + value);
  newPage();
  line("Terms and house rules", { heading: true, size: 12 });
  for (const para of f.terms.split(/\n\s*\n/)) line(para);
  if (y < 300) newPage();
  line("Signatures", { heading: true, size: 12 });
  line(
    "Please read this agreement before signing. A copy must be provided to the resident.",
  );
  for (const name of [...f.resident_names, f.proprietor.name]) {
    if (y < 150) newPage();
    y -= 12;
    line(name, { heading: true });
    line("Signature: ____________________________   Date: __________________");
    y -= 12;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText("SAKAN Lodge | " + (i + 1) + " / " + pages.length, {
      x: 48,
      y: 32,
      font: regular,
      size: 8,
    }),
  );
  return pdf.save();
}
