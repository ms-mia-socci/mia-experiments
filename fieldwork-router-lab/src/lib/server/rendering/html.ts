import sanitizeHtml from "sanitize-html";
export const previewPolicy =
  "sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
export function previewHtml(content: string) {
  return sanitizeHtml(content, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "html",
      "head",
      "title",
      "body",
      "style",
      "img",
      "svg",
      "g",
      "path",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polyline",
      "polygon",
      "text",
      "defs",
      "linearGradient",
      "stop",
    ],
    allowedAttributes: {
      "*": ["class", "id", "style", "title", "width", "height"],
      img: ["src", "alt"],
      svg: ["viewBox", "xmlns"],
      g: ["transform", "fill", "stroke"],
      path: ["d", "fill", "stroke", "stroke-width"],
      rect: ["x", "y", "rx", "ry", "fill", "stroke"],
      circle: ["cx", "cy", "r", "fill", "stroke"],
      ellipse: ["cx", "cy", "rx", "ry", "fill"],
      line: ["x1", "x2", "y1", "y2", "stroke", "stroke-width"],
      polyline: ["points", "fill", "stroke"],
      polygon: ["points", "fill", "stroke"],
      text: ["x", "y", "fill", "font-size", "text-anchor"],
      linearGradient: ["id", "x1", "x2", "y1", "y2"],
      stop: ["offset", "stop-color"],
    },
    allowedSchemes: ["data"],
    allowVulnerableTags: true,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
  });
}
