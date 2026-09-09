import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
import unittest

spec = importlib.util.spec_from_file_location('transcriber', Path(__file__).resolve().parents[1] / 'resources/tools/transcribe-subtitles.py')
module = importlib.util.module_from_spec(spec)
# Keep tests independent of the locally installed model/runtime.
import sys
sys.modules.setdefault('faster_whisper', NS(WhisperModel=None))
spec.loader.exec_module(module)

class TimingTests(unittest.TestCase):
    def test_punctuation_and_pauses_use_real_word_times(self):
        segment = NS(start=0, end=10, text='第一点。第二点然后第三点', words=[
            NS(start=0.4, end=2, word='第一点。'),
            NS(start=3, end=4, word='第二点'),
            NS(start=4.1, end=5, word='然后'),
            NS(start=7, end=9, word='第三点')])
        self.assertEqual(module.timed_segments(segment), [
            {'start': 0.4, 'end': 2.0, 'text': '第一点。'},
            {'start': 3.0, 'end': 5.0, 'text': '第二点然后'},
            {'start': 7.0, 'end': 9.0, 'text': '第三点'}])

    def test_no_sentence_boundary_keeps_word_units(self):
        segment = NS(start=0, end=4, text='你好世界', words=[
            NS(start=0.5, end=1, word='你好'), NS(start=1.1, end=3, word='世界')])
        self.assertEqual(len(module.timed_segments(segment)), 2)

    def test_missing_or_incomplete_words_preserve_original(self):
        for words in ([], [NS(start=0, end=0, word='好')], [NS(start=0.2, end=1, word='漏字')]):
            self.assertEqual(module.timed_segments(NS(start=0, end=4, text='完整原文', words=words)),
                [{'start': 0.0, 'end': 4.0, 'text': '完整原文'}])

if __name__ == '__main__':
    unittest.main()
