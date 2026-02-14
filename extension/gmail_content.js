(function initGmailAttach() {
  function waitForComposeRoot(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const dialog =
          document.querySelector('div[role="dialog"] [aria-label="Message Body"]') ||
          document.querySelector('div[role="dialog"]');
        if (dialog) {
          clearInterval(timer);
          resolve(dialog);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 350);
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || "runtime error"));
          return;
        }
        if (!response) {
          reject(new Error("No response from background."));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || "Unknown error"));
          return;
        }
        resolve(response.data);
      });
    });
  }

  function b64ToFile(base64, fileName, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], fileName, { type: mime || "application/pdf" });
  }

  async function fetchFiles(attachments) {
    const data = await sendMessage({ type: "FETCH_ATTACHMENTS", attachments });
    return (Array.isArray(data) ? data : []).map((item, idx) =>
      b64ToFile(item.base64, item.name || `attachment-${idx + 1}.pdf`, item.mime)
    );
  }

  function findFileInput(composeRoot) {
    const selectors = [
      'input[type="file"][name="Filedata"]',
      'input[type="file"][multiple]',
      'input[type="file"]'
    ];
    for (const selector of selectors) {
      const local = composeRoot.querySelector(selector);
      if (local) return local;
      const global = document.querySelector(selector);
      if (global) return global;
    }
    return null;
  }

  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    try {
      input.files = dt.files;
    } catch (error) {
      return false;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return Boolean(input.files && input.files.length);
  }

  function clickAttachButton(composeRoot) {
    const button =
      composeRoot.querySelector('div[command="Files"]') ||
      composeRoot.querySelector('[data-tooltip*="Attach"]') ||
      composeRoot.querySelector('[aria-label*="Attach"]');
    if (button) {
      button.click();
      return true;
    }
    return false;
  }

  function dropFiles(target, files) {
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    ["dragenter", "dragover", "drop"].forEach((eventType) => {
      try {
        const event = new DragEvent(eventType, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt
        });
        target.dispatchEvent(event);
      } catch (error) {
        // DragEvent can fail on some Gmail builds; keep other strategies.
      }
    });
  }

  async function attachFiles(composeRoot, files) {
    let input = findFileInput(composeRoot);
    if (!input) {
      clickAttachButton(composeRoot);
      await wait(250);
      input = findFileInput(composeRoot);
    }
    if (input && setInputFiles(input, files)) {
      return true;
    }

    const bodyTarget =
      composeRoot.querySelector('[aria-label="Message Body"]') ||
      document.querySelector('[aria-label="Message Body"]') ||
      composeRoot;
    dropFiles(bodyTarget, files);
    await wait(120);
    dropFiles(composeRoot, files);
    return true;
  }

  function attachmentIndicators(composeRoot) {
    return [
      ...composeRoot.querySelectorAll('[title$=".pdf"]'),
      ...composeRoot.querySelectorAll('[aria-label$=".pdf"]'),
      ...composeRoot.querySelectorAll('[data-tooltip$=".pdf"]'),
      ...composeRoot.querySelectorAll("span.aV3"),
      ...composeRoot.querySelectorAll("span.aZo")
    ];
  }

  function countMatchedNames(composeRoot, names) {
    const haystack = `${composeRoot.innerText || ""}\n${document.body ? document.body.innerText || "" : ""}`;
    let matched = 0;
    names.forEach((name) => {
      if (!name) return;
      const rx = new RegExp(escapeRegExp(name));
      if (rx.test(haystack)) matched += 1;
    });
    return matched;
  }

  async function waitForAttachmentRender(composeRoot, fileNames, timeoutMs = 18000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const indicatorCount = attachmentIndicators(composeRoot).length;
      const nameMatchCount = countMatchedNames(composeRoot, fileNames);
      if (indicatorCount > 0 || nameMatchCount > 0) {
        return Math.max(indicatorCount, nameMatchCount);
      }
      await wait(450);
    }
    return 0;
  }

  chrome.runtime.onMessage.addListener(async (message) => {
    if (message?.type === "PING_ATTACH") {
      return;
    }
    if (message?.type !== "ATTACH_PDFS") {
      return;
    }
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) {
      chrome.runtime.sendMessage({ type: "ATTACHMENT_RESULT", ok: true, attached: 0 });
      return;
    }

    const composeRoot = await waitForComposeRoot(30000);
    if (!composeRoot) {
      chrome.runtime.sendMessage({
        type: "ATTACHMENT_RESULT",
        ok: false,
        error: "Compose window not found."
      });
      return;
    }

    try {
      const files = await fetchFiles(attachments);
      if (!files.length) {
        chrome.runtime.sendMessage({
          type: "ATTACHMENT_RESULT",
          ok: false,
          error: "No files fetched for attachment."
        });
        return;
      }
      await attachFiles(composeRoot, files);
      const names = files.map((f) => f.name || "").filter(Boolean);
      const attachedDetected = await waitForAttachmentRender(composeRoot, names);
      if (attachedDetected > 0) {
        chrome.runtime.sendMessage({ type: "ATTACHMENT_RESULT", ok: true, attached: attachedDetected });
      } else {
        chrome.runtime.sendMessage({
          type: "ATTACHMENT_RESULT",
          ok: false,
          attached: 0,
          error: "Attachment upload not detected yet."
        });
      }
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "ATTACHMENT_RESULT",
        ok: false,
        error: String(error && error.message ? error.message : error)
      });
    }
  });
})();
