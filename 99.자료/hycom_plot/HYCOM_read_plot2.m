
clear all; close all; clc;

%% 파일 및 변수명
file_name = 'HYCOM_120701.nc';
v_temp = 'water_temp';
v_u = 'water_u';
v_v = 'water_v';
v_lon  = 'lon';
v_lat  = 'lat';
cand_depth = {'depth','Depth','lev','z'};

%% 데이터 읽기
T   = ncread(file_name, v_temp);   % [ny nx nz]
U   = ncread(file_name, v_u);      % [ny nx nz]
V   = ncread(file_name, v_v);      % [ny nx nz]
lon = ncread(file_name, v_lon);
lat = ncread(file_name, v_lat);

% 결측값 처리
T(T > 1e19) = NaN;
U(U > 1e19) = NaN;
V(V > 1e19) = NaN;

%% 깊이 정보 읽기
dep = [];
for vn = cand_depth
    try
        dep = ncread(file_name, vn{1});
        if ~isempty(dep), break; end
    catch
    end
end
if isempty(dep)
    warning('깊이 정보를 찾지 못했습니다. k=1만 사용합니다.');
    dep = 1;
end
%% 경도 범위 정리
if isvector(lon) && max(lon) > 180
    lon(lon > 180) = lon(lon > 180) - 360;
end
if isvector(lon) && any(diff(lon) < 0)
    [lon, ix] = sort(lon);
    T = T(:, ix, :);
    U = U(:, ix, :);
    V = V(:, ix, :);
end

%% meshgrid 준비
if isvector(lon) && isvector(lat)
    [LON, LAT] = meshgrid(lon, lat);  % [ny, nx]
else
    LON = lon;
    LAT = lat;
end

%% 반복: 깊이별 그림 생성 및 저장
stride = 3;  % 벡터 간격
for k = 1:length(dep)
    Ts = T(:,:,k);
    Us = U(:,:,k);
    Vs = V(:,:,k);

    % stride 적용
    LONs = LON(1:stride:end, 1:stride:end);
    LATs = LAT(1:stride:end, 1:stride:end);
    Usq  = Us(1:stride:end, 1:stride:end);
    Vsq  = Vs(1:stride:end, 1:stride:end);

    % 크기 맞추기
    if ~isequal(size(LONs), size(Usq))
        Usq = Usq';
        Vsq = Vsq';
    end

    %% 플로팅
    fig = figure('Color','w','Visible','off');  % 화면 출력 없이 저장용
    pcolorjw(LON, LAT, Ts);
    shading flat;
    colormap(turbo);
    colorbar;
    caxis([0 32]);
    xlabel('Longitude');
    ylabel('Latitude');
    title(sprintf('HYCOM 수온 및 유속 (Depth = %.0f m, k = %d)', dep(k), k), 'FontWeight','bold');
    set(gca,'Layer','top','Box','on'); axis tight;

    hold on;
    quiver(LONs, LATs, Usq, Vsq, 5, 'k');
    hold off;

    %% 저장
    output_file = sprintf('HYCOM_temp_current_depth_%03dm.png', round(dep(k)));
    print(fig, output_file, '-dpng', '-r600');  % 600dpi 고해상도 저장
    close(fig);
end
