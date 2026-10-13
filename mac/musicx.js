/* Pull Stardew Valley's seasonal music out of the game's wave bank, for the app's
 * optional background music. Run by the app in the background:
 *
 *   osascript -l JavaScript musicx.js "<Content>/XACT/Wave Bank.xwb" <out dir> spring1:93 spring2:91 …
 *
 * Each "name:index" is a track in the wave bank (the game's Sound Bank maps the cue
 * "spring1" to wave 93, and so on). The tracks are XACT ADPCM (Microsoft ADPCM);
 * they're wrapped as a WAV and turned into a small AAC file (<name>.m4a) with macOS's
 * own afconvert. If Core Audio can't read the ADPCM WAV directly, the samples are
 * decoded here first. Nothing leaves the Mac. */
'use strict';
if (typeof ObjC !== 'undefined') ObjC.import('Foundation');

// ---------- base64 (JXA has no atob / btoa) ----------
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var B64I = (function () { var t = new Int16Array(128).fill(-1); for (var i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
function b64decode(s) {
  var n = s.length, pad = s[n - 1] === '=' ? (s[n - 2] === '=' ? 2 : 1) : 0;
  var out = new Uint8Array((n / 4) * 3 - pad), o = 0;
  for (var i = 0; i < n; i += 4) {
    var a = B64I[s.charCodeAt(i)], b = B64I[s.charCodeAt(i + 1)], c = B64I[s.charCodeAt(i + 2)], d = B64I[s.charCodeAt(i + 3)];
    var v = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
function b64encode(u) {
  var parts = [], CH = 3 * 8192;
  for (var p = 0; p < u.length; p += CH) {
    var end = Math.min(u.length, p + CH), s = '';
    for (var i = p; i < end; i += 3) {
      var a = u[i], b = i + 1 < end ? u[i + 1] : 0, c = i + 2 < end ? u[i + 2] : 0;
      var v = (a << 16) | (b << 8) | c;
      s += B64[v >> 18] + B64[(v >> 12) & 63] + (i + 1 < end ? B64[(v >> 6) & 63] : '=') + (i + 2 < end ? B64[v & 63] : '=');
    }
    parts.push(s);
  }
  return parts.join('');
}

// ---------- the wave bank ----------
// XACT 3 wave bank: header with 5 segments (bank data, entry metadata, seek tables,
// entry names, wave data); compact-format entries of 24 bytes.
function parseXwb(head, meta) {
  var dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'WBND') throw new Error('not a wave bank');
  var seg = [];
  for (var i = 0; i < 5; i++) seg.push({ off: dv.getUint32(12 + i * 8, true), len: dv.getUint32(16 + i * 8, true) });
  return { seg: seg };
}
function bankInfo(bank) {
  var dv = new DataView(bank.buffer, bank.byteOffset, bank.byteLength);
  return { count: dv.getUint32(4, true), metaSize: dv.getUint32(72, true) };
}
function entry(meta, metaSize, index) {
  var dv = new DataView(meta.buffer, meta.byteOffset + index * metaSize, metaSize);
  var fmt = dv.getUint32(4, true);
  return {
    tag: fmt & 3, channels: (fmt >>> 2) & 7, rate: (fmt >>> 5) & 0x3ffff, align: (fmt >>> 23) & 0xff,
    offset: dv.getUint32(8, true), length: dv.getUint32(12, true),
  };
}
// XACT ADPCM block layout, as Microsoft ADPCM
function adpcmLayout(e) {
  var blockAlign = (e.align + 22) * e.channels;
  return { blockAlign: blockAlign, samplesPerBlock: (blockAlign / e.channels - 7) * 2 + 2 };
}

// ---------- WAV headers ----------
var COEF = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]];
function adpcmWavHeader(e, dataLen) {
  var L = adpcmLayout(e), blocks = Math.floor(dataLen / L.blockAlign);
  var h = new Uint8Array(12 + 8 + 50 + 12 + 8), dv = new DataView(h.buffer);
  var str = function (o, s) { for (var i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, h.length - 8 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 50, true);
  dv.setUint16(20, 2, true); dv.setUint16(22, e.channels, true); dv.setUint32(24, e.rate, true);
  dv.setUint32(28, Math.floor(e.rate * L.blockAlign / L.samplesPerBlock), true);
  dv.setUint16(32, L.blockAlign, true); dv.setUint16(34, 4, true); dv.setUint16(36, 32, true);
  dv.setUint16(38, L.samplesPerBlock, true); dv.setUint16(40, 7, true);
  for (var i = 0; i < 7; i++) { dv.setInt16(42 + i * 4, COEF[i][0], true); dv.setInt16(44 + i * 4, COEF[i][1], true); }
  str(70, 'fact'); dv.setUint32(74, 4, true); dv.setUint32(78, blocks * L.samplesPerBlock, true);
  str(82, 'data'); dv.setUint32(86, dataLen, true);
  return h;
}
function pcmWavHeader(channels, rate, dataLen) {
  var h = new Uint8Array(44), dv = new DataView(h.buffer);
  var str = function (o, s) { for (var i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * 2, true); dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, dataLen, true);
  return h;
}

// ---------- Microsoft ADPCM decoder ----------
var ADAPT = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
// Decode whole blocks; returns interleaved 16-bit samples.
function decodeMsAdpcm(src, channels, blockAlign, samplesPerBlock) {
  var blocks = Math.floor(src.length / blockAlign);
  var out = new Int16Array(blocks * samplesPerBlock * channels);
  var o = 0;
  var pred = new Int32Array(channels), delta = new Int32Array(channels), s1 = new Int32Array(channels), s2 = new Int32Array(channels);
  var c1 = new Int32Array(channels), c2 = new Int32Array(channels);
  var rd16 = function (p) { var v = src[p] | (src[p + 1] << 8); return v > 32767 ? v - 65536 : v; };
  for (var b = 0; b < blocks; b++) {
    var p = b * blockAlign, ch;
    for (ch = 0; ch < channels; ch++) { pred[ch] = Math.min(6, src[p++]); c1[ch] = COEF[pred[ch]][0]; c2[ch] = COEF[pred[ch]][1]; }
    for (ch = 0; ch < channels; ch++) { delta[ch] = rd16(p); p += 2; }
    for (ch = 0; ch < channels; ch++) { s1[ch] = rd16(p); p += 2; }
    for (ch = 0; ch < channels; ch++) { s2[ch] = rd16(p); p += 2; }
    for (ch = 0; ch < channels; ch++) out[o++] = s2[ch];
    for (ch = 0; ch < channels; ch++) out[o++] = s1[ch];
    var nibbles = (samplesPerBlock - 2) * channels;
    for (var k = 0; k < nibbles; k++) {
      var byte = src[p + (k >> 1)];
      var nib = (k & 1) ? byte & 15 : byte >> 4;
      ch = channels === 2 ? k & 1 : 0;
      var signed = nib >= 8 ? nib - 16 : nib;
      var predicted = (((s1[ch] * c1[ch]) + (s2[ch] * c2[ch])) / 256) | 0;   // rounds toward zero, like Microsoft's decoder
      var sample = predicted + signed * delta[ch];
      if (sample > 32767) sample = 32767; else if (sample < -32768) sample = -32768;
      s2[ch] = s1[ch]; s1[ch] = sample;
      delta[ch] = (ADAPT[nib] * delta[ch]) >> 8;
      if (delta[ch] < 16) delta[ch] = 16;
      out[o++] = sample;
    }
  }
  return out;
}

// ---------- the macOS side ----------
function readBytes(fh, off, len) {
  fh.seekToFileOffset(off);
  var d = fh.readDataOfLength(len);
  return b64decode(d.base64EncodedStringWithOptions(0).js);
}
function dataFrom(bytes) { return $.NSData.alloc.initWithBase64EncodedStringOptions($(b64encode(bytes)), 0); }
function fileSize(path) {
  var a = $.NSFileManager.defaultManager.attributesOfItemAtPathError($(path), null);
  return a && !a.isNil() ? a.fileSize : 0;
}
function afconvert(src, dst) {
  var t = $.NSTask.alloc.init;
  t.launchPath = '/usr/bin/afconvert';
  t.arguments = $(['-f', 'm4af', '-d', 'aac', '-b', '96000', src, dst]);
  t.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
  t.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  t.launch;
  t.waitUntilExit;
  return t.terminationStatus === 0 && fileSize(dst) > 20000;
}
function remove(path) { $.NSFileManager.defaultManager.removeItemAtPathError($(path), null); }

function run(argv) {
  var xwb = argv[0], outDir = argv[1], cues = argv.slice(2);
  var fm = $.NSFileManager.defaultManager;
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(outDir), true, $(), null);
  var fh = $.NSFileHandle.fileHandleForReadingAtPath($(xwb));
  if (!fh || fh.isNil()) { console.log('找不到 ' + xwb); return 'fail'; }
  var head = parseXwb(readBytes(fh, 0, 52));
  var info = bankInfo(readBytes(fh, head.seg[0].off, head.seg[0].len));
  var meta = readBytes(fh, head.seg[1].off, head.seg[1].len);
  var tmpDir = $.NSTemporaryDirectory().js;
  var made = 0;
  cues.forEach(function (c) {
    var name = c.split(':')[0], index = Number(c.split(':')[1]);
    var dst = outDir + '/' + name + '.m4a';
    if (fileSize(dst) > 20000) { made++; return; }
    var e = entry(meta, info.metaSize, index);
    if (e.tag !== 2) { console.log(name + '：不是 ADPCM（' + e.tag + '），跳过'); return; }
    var start = head.seg[4].off + e.offset;
    var tmp = tmpDir + 'stardewdesk-' + name + '.wav';
    // 1. the ADPCM as it is, in a WAV
    fh.seekToFileOffset(start);
    var raw = fh.readDataOfLength(e.length);
    var wav = $.NSMutableData.dataWithData(dataFrom(adpcmWavHeader(e, e.length)));
    wav.appendData(raw);
    wav.writeToFileAtomically($(tmp), true);
    var ok = afconvert(tmp, dst);
    remove(tmp);
    // 2. otherwise decode it here, a slice at a time, into 16-bit PCM
    if (!ok) {
      var L = adpcmLayout(e), blocks = Math.floor(e.length / L.blockAlign);
      var pcmLen = blocks * L.samplesPerBlock * e.channels * 2;
      fm.createFileAtPathContentsAttributes($(tmp), dataFrom(pcmWavHeader(e.channels, e.rate, pcmLen)), $());
      var out = $.NSFileHandle.fileHandleForWritingAtPath($(tmp));
      out.seekToEndOfFile;
      var per = 4096;                                       // blocks per slice
      for (var b = 0; b < blocks; b += per) {
        var n = Math.min(per, blocks - b);
        var src = readBytes(fh, start + b * L.blockAlign, n * L.blockAlign);
        var pcm = decodeMsAdpcm(src, e.channels, L.blockAlign, L.samplesPerBlock);
        out.writeData(dataFrom(new Uint8Array(pcm.buffer)));
      }
      out.closeFile;
      ok = afconvert(tmp, dst);
      remove(tmp);
    }
    if (ok) made++;
    console.log(name + (ok ? ' 完成' : ' 失败'));
  });
  fh.closeFile;
  return made === cues.length ? 'ok' : 'partial';
}
