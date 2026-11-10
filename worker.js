export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    const targetUrl = urlObj.searchParams.get("url");

    if (!targetUrl || !/^https?:\/\//.test(targetUrl)) {
      return new Response("Invalid URL", { status: 400 });
    }

    // Forward request to target site
    const init = {
      method: request.method,
      headers: new Headers(request.headers)
    };

    // Remove host header to avoid mismatch
    init.headers.delete("host");

    // If POST, forward body
    if (request.method === "POST") {
      init.body = await request.text();
    }

    const response = await fetch(targetUrl, init);
    const contentType = response.headers.get("content-type") || "";

    // Handle HTML rewriting
    if (contentType.includes("text/html")) {
      const rewriter = new HTMLRewriter()
        // Rewrite links
        .on("a[href]", {
          element(el) {
            const href = el.getAttribute("href");
            if (href && !href.startsWith("javascript:")) {
              const absolute = new URL(href, targetUrl).href;
              el.setAttribute("href", `/proxy?url=${encodeURIComponent(absolute)}`);
            }
          }
        })
        // Rewrite forms
        .on("form", {
          element(el) {
            const action = el.getAttribute("action") || targetUrl;
            const absolute = new URL(action, targetUrl).href;
            el.setAttribute("action", `/proxy?url=${encodeURIComponent(absolute)}`);
            el.setAttribute("method", (el.getAttribute("method") || "GET").toUpperCase());
          }
        })
        // Rewrite resources
        .on("img[src], script[src], link[href]", {
          element(el) {
            const attr = el.getAttribute("src") ? "src" : "href";
            const val = el.getAttribute(attr);
            if (val) {
              const absolute = new URL(val, targetUrl).href;
              el.setAttribute(attr, absolute);
            }
          }
        })
        // Inject AJAX interception script
        .on("head", {
          element(el) {
            el.append(`
              <script>
                (function() {
                  const originalFetch = window.fetch;
                  window.fetch = function(input, init) {
                    let url = typeof input === 'string' ? input : input.url;
                    if (!url.startsWith('/proxy')) {
                      url = '/proxy?url=' + encodeURIComponent(new URL(url, window.location.href).href);
                    }
                    return originalFetch(url, init);
                  };
                  const originalXHR = window.XMLHttpRequest;
                  window.XMLHttpRequest = function() {
                    const xhr = new originalXHR();
                    const open = xhr.open;
                    xhr.open = function(method, url, async, user, password) {
                      if (!url.startsWith('/proxy')) {
                        url = '/proxy?url=' + encodeURIComponent(new URL(url, window.location.href).href);
                      }
                      return open.call(xhr, method, url, async, user, password);
                    };
                    return xhr;
                  };
                })();
              </script>
            `, { html: true });
          }
        });

      return rewriter.transform(response);
    }

    // Non-HTML content — return as-is
    return response;
  }
};
