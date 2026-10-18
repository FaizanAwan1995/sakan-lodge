import { databaseRpc, json, limitedJson } from "./public-site.js";
import { contractPdf } from "./contract-pdf.js";
export async function bookingContractApi(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (
    request.headers.get("Origin") !== "https://sakanlodge.com" ||
    !/^Bearer \S+$/.test(authorization)
  )
    return json({ error: "Staff sign-in required" }, 403);
  let stage = "authorise";
  try {
    const input = await limitedJson(request, 12000);
    const snapshot = await databaseRpc(
      env,
      "booking_contract_document",
      { p_id: input.id },
      authorization,
    );
    const c = snapshot.contract;
    if (c.document_path) return json({ contract: c });
    stage = "render";
    const bytes = await contractPdf(c, snapshot.code);
    const path = `contracts/${c.reservation_id}/${c.id}/${crypto.randomUUID()}.pdf`;
    stage = "store";
    const result = await fetch(
      env.SUPABASE_URL.replace(/\/$/, "") +
        "/storage/v1/object/reservation-contracts/" +
        path,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          apikey: env.SUPABASE_PUBLIC_KEY,
          "Content-Type": "application/pdf",
          "x-upsert": "false",
        },
        body: bytes,
      },
    );
    if (!result.ok) throw Error("Unable to store private PDF");
    stage = "register";
    const saved = await databaseRpc(
      env,
      "booking_contract_document",
      { p_id: c.id, p_path: path },
      authorization,
    );
    return json({ contract: saved.contract });
  } catch {
    return json(
      {
        error: {
          authorise:
            "Your staff session could not access this agreement. Sign in again and retry.",
          render:
            "This agreement could not be rendered. Review its details or generate a replacement contract.",
          store:
            "The PDF could not be saved privately. Retry opening the contract.",
          register:
            "The PDF could not be linked to this reservation. Retry opening the contract.",
        }[stage],
      },
      409,
    );
  }
}
