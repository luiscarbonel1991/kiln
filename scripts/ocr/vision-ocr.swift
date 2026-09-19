// vision-ocr — local OCR for the kiln QC gate on macOS (Apple Vision framework).
// No network, no cost. Prints one JSON object:
//   { engine, width, height, lines: [{ text, confidence, candidates, bbox: {x,y,w,h} }] }
// bbox is normalized to the image (0..1), origin TOP-left (Vision's own origin is
// bottom-left; converted here so every consumer thinks in screen coordinates).
// usage: vision-ocr <image> [--min-height 0.01]
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: vision-ocr <image> [--min-height 0.01]\n".data(using: .utf8)!)
  exit(64)
}
var minHeight: Float = 0.01
if let i = args.firstIndex(of: "--min-height"), i + 1 < args.count, let v = Float(args[i + 1]) {
  minHeight = v
}
let url = URL(fileURLWithPath: args[1])
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
  let cg = CGImageSourceCreateImageAtIndex(src, 0, nil)
else {
  FileHandle.standardError.write("cannot read image: \(args[1])\n".data(using: .utf8)!)
  exit(66)
}

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
// Verbatim reading: product wording is codes and names ("UNIT 204", "01", "STAFF ONLY"),
// so no dictionary correction and no language guessing.
req.usesLanguageCorrection = false
req.automaticallyDetectsLanguage = false
req.recognitionLanguages = ["en-US"]
// Vision ignores text under 1/32 of the height by default; go lower so the QC gate
// (not the OCR engine) decides what is too small to read.
req.minimumTextHeight = minHeight

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
  try handler.perform([req])
} catch {
  FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
  exit(70)
}

var lines: [[String: Any]] = []
for obs in req.results ?? [] {
  let cands = obs.topCandidates(3)
  guard let top = cands.first else { continue }
  let bb = obs.boundingBox
  lines.append([
    "text": top.string,
    "confidence": top.confidence,
    "candidates": cands.map { $0.string },
    "bbox": ["x": bb.minX, "y": 1 - bb.maxY, "w": bb.width, "h": bb.height],
  ])
}
let out: [String: Any] = [
  "engine": "apple-vision", "width": cg.width, "height": cg.height, "lines": lines,
]
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
