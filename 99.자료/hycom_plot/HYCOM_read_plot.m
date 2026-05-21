
%% 파일 및 변수명
file_name = 'HYCOM_120701.nc';
v_temp = 'water_temp';
v_lon  = 'lon';        % 경우에 따라 'longitude'
v_lat  = 'lat';        % 경우에 따라 'latitude'
cand_depth = {'depth','Depth','lev','z'};  % 깊이 변수 후보들

%% 데이터 읽기
T   = ncread(file_name, v_temp);   % size: [ny nx nz] = [626 813 40]
lon = ncread(file_name, v_lon);    % 기대: [nx] 또는 [ny x nx]
lat = ncread(file_name, v_lat);    % 기대: [ny] 또는 [ny x nx]

% 결측/채움값 처리 (HYCOM은 보통 1e20 근방)
T(T > 1e19) = NaN;

%% 깊이 읽기 및 표층 인덱스 결정
dep = [];
for vn = cand_depth
    try
        dep = ncread(file_name, vn{1});
        if ~isempty(dep), break; end
    catch
    end
end
if ~isempty(dep)
    % dep가 얕은->깊은(증가)면 표층은 1, 저층 40
    if dep(1) <= dep(end)
        k_surf = 1;
    else
        k_surf = numel(dep);
    end
else
    % 깊이 변수가 없으면 보편 가정: k=1이 표층
    warning('깊이 변수(depth/lev)를 찾지 못했습니다. k=1을 표층으로 가정합니다.');
    k_surf = 1;
end

%% 표층 수온 추출
Ts = T(:,:,k_surf);   % size: [ny nx]

%% 경도 범위 정리 (0~360 -> -180~180 권장)
if isvector(lon) && max(lon) > 180
    lon(lon > 180) = lon(lon > 180) - 360;
end

% 경도가 벡터이고 wrap 이후 감소 구간이 있으면 정렬 및 데이터 재정렬
if isvector(lon) && any(diff(lon) < 0)
    [lon, ix] = sort(lon);
    Ts = Ts(:, ix);
end
%% lon/lat 차원 확인 및 meshgrid 준비 (pcolor 대비)
% 일반적으로 size(Ts) = [length(lat)  length(lon)]
needMesh = false;
if isvector(lon) && isvector(lat)
    % good: Ts(i,j) <-> lat(i), lon(j)
    % pcolor는 X,Y에 행렬 필요(표준 pcolor의 경우), pcolorjw는 벡터 OK
    needMesh = ~exist('pcolorjw','file');
else
    % lon/lat이 이미 2D 행렬이면 그대로 사용
    needMesh = false;
end

if needMesh
    [LON, LAT] = meshgrid(lon, lat);  %#ok<UNRCH> (필요시 활성화됨)
end

%% 플로팅
figure('Color','w');

if exist('pcolorjw','file')
    % pcolorjw는 마지막 행/열 누락 없이 그려주는 유틸
    pcolorjw(lon, lat, Ts);
    shading flat;
else
    % 표준 pcolor는 마지막 행/열을 드랍하므로 shading flat 권장
    if exist('LON','var')
        pcolor(LON, LAT, Ts);
    else
        % 혹시 lon/lat이 2D라면 그대로 사용
        pcolor(lon, lat, Ts);
    end
    shading flat;
end
colormap(turbo);         % R2020b+ (이전 버전이면 parula 사용)
colorbar;
caxis([0 32]);           % 사용자가 지정한 범위
xlabel('Longitude');
ylabel('Latitude');
title(sprintf('HYCOM 수온 (표층, k=%d)', k_surf), 'FontWeight','bold');
set(gca,'Layer','top','Box','on'); axis tight;
