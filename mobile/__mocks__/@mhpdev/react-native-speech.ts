const Speech = {
  configure: jest.fn(),
  getAvailableVoices: jest.fn().mockResolvedValue([]),
  isSpeaking: jest.fn().mockResolvedValue(false),
  speak: jest.fn().mockResolvedValue('utterance-id'),
  stop: jest.fn().mockResolvedValue(undefined),
};
export default Speech;
