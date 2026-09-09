import { chromium } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
const base = "http://127.0.0.1:5373",
  browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(
    "<h1>PDF verification</h1><p>The project name is Moonflower.</p>",
  );
  const pdf = await pdfPage.pdf();
  await pdfPage.close();
  const png = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  await p.goto(base);
  await p.getByRole("button", { name: /Mia Socci/ }).click();
  await p.waitForLoadState("networkidle");
  let last;
  for (const framework of ["strands", "claude", "codex"]) {
    const t = await (
      await p.request.post(base + "/api/threads", {
        headers: { Origin: base },
        data: { framework },
      })
    ).json();
    const up = await p.request.post(`${base}/api/threads/${t.id}/attachments`, {
      headers: { Origin: base },
      multipart: {
        files: {
          name: "verification.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Verification code: MARIGOLD-742."),
        },
      },
    });
    assert.equal(up.status(), 200, await up.text());
    const textFile = (await up.json()).items[0];
    const ip = await p.request.post(`${base}/api/threads/${t.id}/attachments`, {
      headers: { Origin: base },
      multipart: {
        files: { name: "color.png", mimeType: "image/png", buffer: png },
      },
    });
    assert.equal(ip.status(), 200, await ip.text());
    const imageFile = (await ip.json()).items[0];
    const pp = await p.request.post(`${base}/api/threads/${t.id}/attachments`, {
      headers: { Origin: base },
      multipart: {
        files: {
          name: "project.pdf",
          mimeType: "application/pdf",
          buffer: pdf,
        },
      },
    });
    assert.equal(pp.status(), 200, await pp.text());
    const pdfFile = (await pp.json()).items[0];
    const r = await p.request.post(`${base}/api/threads/${t.id}/run`, {
      headers: { Origin: base },
      data: {
        threadId: t.id,
        runId: crypto.randomUUID(),
        state: {},
        messages: [
          {
            id: crypto.randomUUID(),
            role: "user",
            content:
              "Read the attached files. Reply with the verification code in the text file, the project name from the PDF, and the solid color in the image. No tools or file creation.",
          },
        ],
        tools: [],
        context: [],
        forwardedProps: {
          attachmentIds: [textFile.id, imageFile.id, pdfFile.id],
        },
      },
      timeout: 120000,
    });
    const stream = await r.text();
    assert.ok(stream.includes("RUN_FINISHED"), stream.slice(-1500));
    const saved = await (
      await p.request.get(`${base}/api/threads/${t.id}`)
    ).json();
    const answer = saved.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join(" ");
    assert.match(answer, /MARIGOLD-742/);
    assert.match(answer, /Moonflower/i);
    assert.match(answer, /red/i);
    assert.equal(saved.messages[0].attachments.length, 3);
    console.log(framework, answer);
    last = { t, imageFile };
  }
  const other = await browser.newPage();
  await other.goto(base);
  await other.getByRole("button", { name: /Tim Ritzema/ }).click();
  await other.waitForLoadState("networkidle");
  assert.equal(
    (await other.request.get(base + last.imageFile.url)).status(),
    404,
  );
  assert.equal(
    (
      await other.request.post(`${base}/api/threads/${last.t.id}/attachments`, {
        headers: { Origin: base },
        multipart: {
          files: {
            name: "a.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("test"),
          },
        },
      })
    ).status(),
    404,
  );
  console.log("Cross-user access rejected");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
