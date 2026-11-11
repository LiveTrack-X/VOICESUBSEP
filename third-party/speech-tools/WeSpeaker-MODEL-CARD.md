---
license: cc-by-4.0
language:
- en
pipeline_tag: summarization
tags:
- speaker embedding
- wespeaker
- speaker modelling
---


Official model provided by [Wespeaker](https://github.com/wenet-e2e/wespeaker) project, ResNet34 based r-vector (After large margin finetune)

The model is trained on VoxCeleb2 Dev dataset, containing 5994 speakers.


## Model Sources

<!-- Provide the basic links for the model. -->

- **Repository:** https://github.com/wenet-e2e/wespeaker
- **Paper:** https://arxiv.org/pdf/2210.17016.pdf
- **Demo:** https://huggingface.co/spaces/wenet/wespeaker_demo


## Results on VoxCeleb
| Model | Params | Flops | LM | AS-Norm | vox1-O-clean | vox1-E-clean | vox1-H-clean |
|:------|:------:|:------|:--:|:-------:|:------------:|:------------:|:------------:|
| ResNet34-TSTP-emb256 | 6.63M | 4.55G | × | × | 0.867 | 1.049 | 1.959 |
|                      |       |       | × | √ | 0.787 | 0.964 | 1.726 |
|                      |       |       | √ | × | 0.797 | 0.937 | 1.695 |
|                      |       |       | √ | √ | 0.723 | 0.867 | 1.532 |

## Install Wespeaker

``` sh
pip install git+https://github.com/wenet-e2e/wespeaker.git
```

for development install:

``` sh
git clone https://github.com/wenet-e2e/wespeaker.git
cd wespeaker
pip install -e .
```


### Command line Usage

``` sh
$ wespeaker -p ResNet34_download_dir --task embedding --audio_file audio.wav --output_file embedding.txt
$ wespeaker -p ResNet34_download_dir --task embedding_kaldi --wav_scp wav.scp --output_file /path/to/embedding
$ wespeaker -p ResNet34_download_dir --task similarity --audio_file audio.wav --audio_file2 audio2.wav
$ wespeaker -p ResNet34_download_dir --task diarization --audio_file audio.wav
```

### Python Programming Usage

``` python
import wespeaker

model = wespeaker.load_model_local(ResNet34_download_dir)
# set_gpu to enable the cuda inference, number < 0 means using CPU
model.set_gpu(0)

# embedding/embedding_kaldi/similarity/diarization
embedding = model.extract_embedding('audio.wav')
utt_names, embeddings = model.extract_embedding_list('wav.scp')
similarity = model.compute_similarity('audio1.wav', 'audio2.wav')
diar_result = model.diarize('audio.wav')

# register and recognize
model.register('spk1', 'spk1_audio1.wav')
model.register('spk2', 'spk2_audio1.wav')
model.register('spk3', 'spk3_audio1.wav')
result = model.recognize('spk1_audio2.wav')
```

## Citation


```bibtex
@article{zeinali2019rvector,
  title={But system description to voxceleb speaker recognition challenge 2019},
  author={Zeinali, Hossein and Wang, Shuai and Silnova, Anna and Mat{\v{e}}jka, Pavel and Plchot, Old{\v{r}}ich},
  journal={arXiv preprint arXiv:1910.12592},
  year={2019}
}

@inproceedings{wang2023wespeaker,
  title={Wespeaker: A research and production oriented speaker embedding learning toolkit},
  author={Wang, Hongji and Liang, Chengdong and Wang, Shuai and Chen, Zhengyang and Zhang, Binbin and Xiang, Xu and Deng, Yanlei and Qian, Yanmin},
  booktitle={IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP)},
  pages={1--5},
  year={2023},
  organization={IEEE}
}
```
