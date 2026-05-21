# Ocean3D 프로젝트 안내

## 버전 정보

- 현재 문서 기준 릴리스 버전: **v1.0**
- 태그/커밋 권장 메시지 예시: `v1.0`

이 프로젝트는 HYCOM 해양 NetCDF 데이터를 3D로 시각화하는 웹 앱입니다.  
화면에서 수온/염분/유속을 수심별로 확인하고, 마우스 호버로 해당 지점 값을 조회할 수 있습니다.

## 1. 프로젝트 구성

- `oceanpy`  
  Python(FastAPI) 백엔드입니다.  
  NetCDF 파일을 읽어 수온/염분/유속 데이터를 바이너리 형태로 가공해 API로 제공합니다.

- `oceanthreejs`  
  Java(Spring Boot) + Three.js 프론트 서버입니다.  
  브라우저 화면을 제공하고, Python API를 프록시(`/api/*`)로 연결합니다.

## 2. 어떤 데이터를 어떻게 표출하나요?

- 원천 데이터 파일
  - `oceanpy/99.data/HYCOM_120701.nc`
  - (해안선) `oceanpy/99.data/ne_10m_coastline.shp`, `ne_10m_coastline.shx`

- 주요 시각화 항목
  - `수온 보기 (temp)`: 3D 큐브 색상으로 수온 분포 표시
  - `염분 보기 (salt)`: 3D 큐브 색상으로 염분 분포 표시
  - `유속 보기 (current)`: 화살표(벡터)와 애니메이션으로 흐름 표시

- 수심 슬라이더
  - 수심 인덱스 기준으로 필터링합니다.
  - `0`일 때는 전체 수심을, `0`보다 큰 값에서는 해당 수심 레벨만 표시하도록 동작합니다.

- 호버 정보
  - 경도, 위도, 수심, 수온/염분 값을 표시합니다.
  - 현재 보이는(필터된) 데이터만 호버 대상으로 사용합니다.

## 3. 서버 실행 방법 (처음부터 따라하기)

아래 순서대로 **Python API(5002)** 와 **Spring 서버(8081)** 를 함께 띄워야 정상 동작합니다.

### 3-1. Python API 실행

```bash
cd /Users/jeongsumin/DEV/work/ocean3D/oceanpy
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

정상 실행 시 기본적으로 `http://localhost:5002` 에서 API가 열립니다.

### 3-2. Spring(Three.js) 서버 실행

새 터미널에서:

```bash
cd /Users/jeongsumin/DEV/work/ocean3D/oceanthreejs
./gradlew bootRun
```

정상 실행 시 `http://localhost:8081` 로 접속합니다.

## 4. 동작 확인 포인트

- 브라우저에서 `http://localhost:8081` 접속
- 수온/염분/유속 버튼 전환
- 수심 슬라이더 이동
- 마우스 호버로 값 표시 확인

## 5. 설정 정보

- Spring 포트: `8081`
  - `oceanthreejs/src/main/resources/application.properties`
  - `server.port=8081`

- Python API 기본 URL(프록시 대상): `http://localhost:5002`
  - `oceanthreejs/src/main/resources/application.properties`
  - `ocean.api.base-url=http://localhost:5002`

## 6. 문제 해결(자주 겪는 이슈)

- 화면이 안 뜨거나 API 에러가 날 때
  - Python 서버(`app.py`)가 먼저 실행 중인지 확인
  - `oceanpy/99.data/HYCOM_120701.nc` 파일 존재 여부 확인

- 버튼/슬라이더 반응이 이상할 때
  - 브라우저 강력 새로고침
  - 두 서버를 모두 재시작

## 7. v1.0 릴리스 노트

- 수온/염분/유속 3D 시각화 및 모드 전환
- 수심 슬라이더 기반 조회 및 호버 정보 표시
- 유속 화살표 애니메이션 표시
- 해안선/축/범례 UI 및 지구본 미니맵 표시
- Spring 프록시(8081) + FastAPI 데이터 서버(5002) 연동
