/**
 * Firebase Storage Service - Health check and upload support
 */
const admin = require('firebase-admin');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let bucket = null;

const initializeFirebaseStorage = () => {
  try {
    if (!admin.apps.length) return false;
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'taqdeem-7a621.firebasestorage.app';
    bucket = admin.storage().bucket(bucketName);
    return true;
  } catch (error) {
    console.error('Firebase Storage init error:', error.message);
    return false;
  }
};

const isGCSAvailable = () => {
  if (!bucket) return initializeFirebaseStorage();
  return !!bucket;
};

const uploadToGCS = async (fileBuffer, fileName, folder = 'health-check', contentType = 'image/png') => {
  if (!isGCSAvailable()) throw new Error('Firebase Storage not configured');
  const uniqueFileName = `${folder}/${uuidv4()}-${Date.now()}${path.extname(fileName)}`;
  const file = bucket.file(uniqueFileName);
  await file.save(fileBuffer, {
    metadata: { contentType, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFileName)}?alt=media`;
  return { fileName: uniqueFileName, url: publicUrl };
};

const deleteFromGCS = async (fileName) => {
  if (!isGCSAvailable()) return;
  await bucket.file(fileName).delete();
};

module.exports = {
  initializeFirebaseStorage,
  isGCSAvailable,
  uploadToGCS,
  deleteFromGCS,
};
