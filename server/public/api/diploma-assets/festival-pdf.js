/* The print dialog on phones can resize an A4 SVG. Export the editor's own layout
   onto fixed PDF pages instead. The original JPEG and stamp are shared by every page. */
(() => {
  const pageSize = [210 * 72 / 25.4, 297 * 72 / 25.4];
  const scaleX = pageSize[0] / $('sheet').viewBox.baseVal.width;
  const scaleY = pageSize[1] / $('sheet').viewBox.baseVal.height;
  const pixelsPerPoint = 300 / 72;
  const measure = document.createElement('canvas').getContext('2d');
  const download = $('pdf-download');
  const share = $('pdf-share');
  const status = $('pdf-status');
  let output = null;
  let running = false;
  let revision = 0;

  // Use the same shaped text, font fallback, anchors and baselines as the preview.
  // Crop each transparent field before encoding it to keep mobile memory usage low.
  async function rasterField(doc, group) {
    const font = group.getAttribute('font-weight') + ' ' +
      group.getAttribute('font-size') + 'px ' + group.getAttribute('font-family');
    const anchor = group.getAttribute('text-anchor');
    const align = anchor === 'middle' ? 'center' : anchor;
    measure.font = font;
    measure.textAlign = align;
    const lines = Array.from(group.children, node => ({
      text: node.textContent, x: Number(node.getAttribute('x')), y: Number(node.getAttribute('y'))
    }));
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const line of lines) {
      const box = measure.measureText(line.text);
      left = Math.min(left, line.x - box.actualBoundingBoxLeft);
      right = Math.max(right, line.x + box.actualBoundingBoxRight);
      top = Math.min(top, line.y - box.actualBoundingBoxAscent);
      bottom = Math.max(bottom, line.y + box.actualBoundingBoxDescent);
    }
    left = Math.floor(left) - 2;
    top = Math.floor(top) - 2;
    const width = Math.ceil(right) + 2 - left;
    const height = Math.ceil(bottom) + 2 - top;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * pixelsPerPoint);
    canvas.height = Math.ceil(height * pixelsPerPoint);
    try {
      const ctx = canvas.getContext('2d');
      ctx.scale(canvas.width / width, canvas.height / height);
      ctx.font = font;
      ctx.textAlign = align;
      ctx.fillStyle = group.getAttribute('fill');
      for (const line of lines) ctx.fillText(line.text, line.x - left, line.y - top);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw Error('Не удалось подготовить текст диплома.');
      const image = await doc.embedPng(await png.arrayBuffer());
      await image.embed(); // Release the decoded pixel buffers before the next field.
      return {image, placement: {
        x: left * scaleX, y: pageSize[1] - (top + height) * scaleY,
        width: width * scaleX, height: height * scaleY
      }};
    } finally {
      canvas.width = canvas.height = 1;
    }
  }

  async function buildPdf(rows, seal, firstIndex) {
    await fontsReady;
    const doc = await PDFLib.PDFDocument.create();
    const background = await doc.embedJpg($('sheet').querySelector('image').getAttribute('href'));
    const stampImage = seal.image ? await doc.embedPng(seal.image) : null;
    const mm = 72 / 25.4;
    const cache = new Map();
    const layer = document.createElementNS(NS, 'g');
    for (const [index, row] of rows.entries()) {
      status.textContent = 'Подготовка PDF · ' + (index + 1) + ' из ' + rows.length;
      const issues = paint(row, layer);
      if (issues.length) {
        selectRecord(firstIndex + index);
        throw Error('Диплом № ' + (firstIndex + index + 1) + '. ' + issues[0]);
      }
      const page = doc.addPage(pageSize);
      page.drawImage(background, {x:0, y:0, width:pageSize[0], height:pageSize[1]});
      for (const group of layer.querySelectorAll('g[data-field]')) {
        const key = group.outerHTML;
        if (!cache.has(key)) cache.set(key, await rasterField(doc, group));
        const {image, placement} = cache.get(key);
        page.drawImage(image, placement);
      }
      if (stampImage) {
        const height = seal.width / seal.ratio;
        page.drawImage(stampImage, {
          x: seal.x * mm, y: pageSize[1] - (seal.y + height) * mm,
          width: seal.width * mm, height: height * mm
        });
      }
      // Let progress and taps be processed even when most fields are cached.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return doc.save();
  }

  function clearResult() {
    if (download.hasAttribute('href')) URL.revokeObjectURL(download.href);
    download.removeAttribute('href');
    download.hidden = share.hidden = true;
    output = null;
  }

  async function exportPdf(all) {
    if (running) return;
    running = true;
    $('save-pdf').disabled = $('all-pdf').disabled = true;
    clearResult();
    const snapshotRevision = revision;
    const firstIndex = all ? 0 : current;
    const rows = (all ? records : [data]).map(row => ({...row}));
    const seal = {...stamp};
    const name = rows[0][rows[0].mode].trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 96);
    const filename = all ? 'Дипломы фестиваля (' + rows.length + ').pdf' : 'Диплом — ' + name + '.pdf';
    $('pdf-result').hidden = false;
    status.textContent = 'Подготовка PDF…';
    try {
      const bytes = await buildPdf(rows, seal, firstIndex);
      if (revision !== snapshotRevision) {
        status.textContent = 'Диплом изменился. Нажмите «Сохранить PDF» ещё раз.';
        return;
      }
      output = new File([bytes], filename, {type: 'application/pdf'});
      download.download = filename;
      download.href = URL.createObjectURL(output);
      download.hidden = false;
      status.textContent = 'Готово · ' + filename;
      share.hidden = !(navigator.canShare && navigator.canShare({files:[output]}));
      // Keep a visible download link for browsers that require a fresh user gesture.
      download.click();
    } catch (err) {
      status.textContent = err.message || 'Не удалось сохранить PDF. Попробуйте ещё раз.';
    } finally {
      running = false;
      $('save-pdf').disabled = $('all-pdf').disabled = false;
      if (all) $('pdf-result').scrollIntoView({block:'nearest'});
    }
  }

  document.addEventListener('festival-diploma-change', () => {
    revision++;
    if (!running) {
      clearResult();
      $('pdf-result').hidden = true;
    }
  });
  share.addEventListener('click', async () => {
    if (!output) return;
    try { await navigator.share({files: [output]}); }
    catch (err) {
      if (err.name !== 'AbortError') status.textContent = 'Используйте ссылку «Скачать PDF».';
    }
  });
  $('save-pdf').addEventListener('click', () => exportPdf(false));
  $('all-pdf').addEventListener('click', () => exportPdf(true));
})();
