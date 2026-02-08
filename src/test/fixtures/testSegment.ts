/**
 * Test fixture for automated testing
 * Uses cached data from video i1AMYsR7xHQ
 */

export const TEST_VIDEO_ID = 'i1AMYsR7xHQ';

// 10-second segment from the cached video (150s - 160s)
export const TEST_SEGMENT = {
  videoId: TEST_VIDEO_ID,
  name: 'Test Segment',
  startTime: 150.0,
  endTime: 160.0,
  tempo: 120,
  timeSignature: { numerator: 4, denominator: 4 },
};

// Absolute frame timestamps (matching cached frame files)
// Frames are named like frame_150_43.jpg = 150.43 seconds
export const TEST_FRAME_TIMES = [
  150.43, 150.93, 151.43, 151.93, 152.43, 152.93, 153.43, 153.93,
  154.43, 154.93, 155.43, 155.93, 156.43, 156.93, 157.43, 157.93,
  158.43, 158.93, 159.43, 159.93
];

// Path to cached data
export const CACHE_DIR = 'extracted-audio';
export const FRAMES_DIR = `${CACHE_DIR}/frames/${TEST_VIDEO_ID}`;
export const AUDIO_FILE = `${CACHE_DIR}/${TEST_VIDEO_ID}.wav`;
export const VIDEO_FILE = `${CACHE_DIR}/${TEST_VIDEO_ID}.mp4`;
