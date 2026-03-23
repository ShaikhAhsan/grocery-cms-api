const processImageUrl = (image, baseUrl) => {
  if (!image) return null;
  const base = baseUrl || process.env.BASE_URL || '';
  return image.startsWith('http') ? image : (base ? `${base.replace(/\/$/, '')}/${image.replace(/^\//, '')}` : image);
};

const getFileExtension = (url) => {
  if (!url || typeof url !== 'string') return '.jpg';
  const match = url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
};

module.exports = { processImageUrl, getFileExtension };
