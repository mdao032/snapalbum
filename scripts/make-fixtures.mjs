// Generates the files of tests/fixtures/ (SPEC 8.1, step 2.5): photos with EXIF orientation, with
// GPS, plain PNG and WebP, short and long videos, corrupted files. Run it with
// `pnpm fixtures:make`; the output is committed, so it is only needed to change a fixture.
// Needs `ffmpeg` on the PATH for the videos. The HEIC fixture comes from make-heic-fixture.py.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = new URL("../tests/fixtures/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const write = (name, data) => writeFileSync(new URL(name, OUT), data);

/** Four coloured quarters (red, green / blue, yellow): any wrong turn or flip is visible. */
async function quarters(width, height) {
  const w2 = Math.floor(width / 2);
  const h2 = Math.floor(height / 2);
  const tile = (color, w, h) => ({
    create: { width: w, height: h, channels: 3, background: color },
  });
  return sharp({ create: { width, height, channels: 3, background: "#808080" } })
    .composite([
      {
        input: await sharp(tile("#e03030", w2, h2))
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
      {
        input: await sharp(tile("#30c030", width - w2, h2))
          .png()
          .toBuffer(),
        left: w2,
        top: 0,
      },
      {
        input: await sharp(tile("#3050e0", w2, height - h2))
          .png()
          .toBuffer(),
        left: 0,
        top: h2,
      },
      {
        input: await sharp(tile("#e0d030", width - w2, height - h2))
          .png()
          .toBuffer(),
        left: w2,
        top: h2,
      },
    ])
    .png()
    .toBuffer();
}

// The upright picture is 64 x 96 (portrait). Stored turned a quarter anticlockwise (96 x 64) with
// orientation 6, which a reader must turn back clockwise to show it as the camera saw it.
const upright = await quarters(64, 96);
const storedSideways = await sharp(upright).rotate(270).png().toBuffer();
write(
  "jpeg-orientation-6.jpg",
  await sharp(storedSideways)
    .withExif({
      IFD0: { Make: "Fixture", Model: "Orientation 6" },
      IFD2: { DateTimeOriginal: "2026:06:14 16:45:10", OffsetTimeOriginal: "+02:00" },
    })
    // Set apart: sharp resets the tag of a picture it has just rotated.
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 90 })
    .toBuffer(),
);

// A landscape photo with a position (Paris), taken at a known time without a zone.
write(
  "jpeg-gps.jpg",
  await sharp(await quarters(128, 96))
    .withExif({
      IFD0: { Make: "Fixture", Model: "GPS" },
      IFD2: { DateTimeOriginal: "2025:08:02 09:15:30" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "48/1 51/1 2400/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 21/1 700/100",
      },
    })
    .jpeg({ quality: 90 })
    .toBuffer(),
);

write(
  "jpeg-plain.jpg",
  await sharp(await quarters(96, 64))
    .jpeg({ quality: 85 })
    .toBuffer(),
);
write("png-photo.png", await quarters(96, 64));
write(
  "webp-photo.webp",
  await sharp(await quarters(96, 64))
    .webp({ quality: 80 })
    .toBuffer(),
);
// A photo too large for a thumbnail: the display version must be scaled down to 2 048 px.
write(
  "jpeg-large.jpg",
  await sharp(await quarters(3000, 2000))
    .jpeg({ quality: 70 })
    .toBuffer(),
);

// A date that is not one (blank clock), an orientation out of range: both must be ignored.
write(
  "jpeg-bad-exif.jpg",
  await sharp(await quarters(96, 64))
    .withExif({
      IFD0: { Orientation: "1" },
      IFD2: { DateTimeOriginal: "0000:00:00 00:00:00" },
    })
    .jpeg()
    .toBuffer(),
);

// Corrupted files: a real header followed by nothing decodable, and bytes that are no picture.
const plain = await sharp(await quarters(96, 64))
  .jpeg()
  .toBuffer();
write("corrupted.jpg", Buffer.concat([plain.subarray(0, 200), Buffer.alloc(300, 0x41)]));
write(
  "corrupted.png",
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("this is not a png"),
  ]),
);
write("not-an-image.jpg", Buffer.from("<html>pas une image</html>"));
write("corrupted.mp4", Buffer.from("not a video at all, only text pretending to be one"));

// Videos: tiny but real. 160 x 120 for two seconds, and 45 s (over the free plan's 30 s).
function video(name, seconds, codecArgs) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=160x120:rate=5:duration=${seconds}`,
      ...codecArgs,
      new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${name}: ${result.stderr}`);
}
const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "35", "-movflags", "+faststart"];
video("video-2s.mp4", 2, h264);
video("video-45s.mp4", 45, [...h264, "-g", "50"]);
video("video-2s.webm", 2, ["-c:v", "libvpx", "-crf", "35", "-b:v", "100k"]);
// The browsers of the end-to-end tests have no H.264 decoder: the same 45 s clip in VP8.
video("video-45s.webm", 45, ["-c:v", "libvpx", "-crf", "40", "-b:v", "60k"]);
video("video-2s.mov", 2, [...h264, "-f", "mov"]);

console.log("tests/fixtures/ generated (HEIC: python scripts/make-heic-fixture.py)");
