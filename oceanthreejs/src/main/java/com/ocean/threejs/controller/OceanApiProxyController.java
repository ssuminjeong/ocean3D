package com.ocean.threejs.controller;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
public class OceanApiProxyController {

    private final HttpClient httpClient;
    private final String oceanApiBaseUrl;

    public OceanApiProxyController(
        @Value("${ocean.api.base-url:http://localhost:5002}") String oceanApiBaseUrl
    ) {
        this.httpClient = HttpClient.newHttpClient();
        this.oceanApiBaseUrl = oceanApiBaseUrl;
    }

    @GetMapping(value = "/api/ocean_3d", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> getOcean3d(
        @RequestParam(name = "type", defaultValue = "temp") String type,
        @RequestParam(name = "time_idx", defaultValue = "0") int timeIdx,
        @RequestParam(name = "depth_idx", defaultValue = "0") int depthIdx,
        @RequestParam(name = "stride", defaultValue = "5") int stride
    ) throws IOException, InterruptedException {
        String encodedType = URLEncoder.encode(type, StandardCharsets.UTF_8);
        URI uri = URI.create(
            oceanApiBaseUrl + "/api/ocean_3d?type=" + encodedType
            + "&time_idx=" + timeIdx
            + "&depth_idx=" + depthIdx
            + "&stride=" + stride
        );
        return proxyBinary(uri);
    }

    @GetMapping(value = "/api/current_vectors", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> getCurrentVectors(
        @RequestParam(name = "time_idx", defaultValue = "0") int timeIdx,
        @RequestParam(name = "depth_idx", defaultValue = "0") int depthIdx,
        @RequestParam(name = "stride", defaultValue = "24") int stride
    ) throws IOException, InterruptedException {
        URI uri = URI.create(
            oceanApiBaseUrl + "/api/current_vectors?time_idx=" + timeIdx
            + "&depth_idx=" + depthIdx
            + "&stride=" + stride
        );
        return proxyBinary(uri);
    }

    @GetMapping(value = "/api/ocean_3d_roi", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> getOcean3dRoi(
        @RequestParam(name = "type", defaultValue = "temp") String type,
        @RequestParam(name = "time_idx", defaultValue = "0") int timeIdx,
        @RequestParam(name = "stride", defaultValue = "3") int stride,
        @RequestParam(name = "lon_min") double lonMin,
        @RequestParam(name = "lon_max") double lonMax,
        @RequestParam(name = "lat_min") double latMin,
        @RequestParam(name = "lat_max") double latMax
    ) throws IOException, InterruptedException {
        String encodedType = URLEncoder.encode(type, StandardCharsets.UTF_8);
        URI uri = URI.create(
            oceanApiBaseUrl + "/api/ocean_3d_roi?type=" + encodedType
            + "&time_idx=" + timeIdx
            + "&stride=" + stride
            + "&lon_min=" + lonMin
            + "&lon_max=" + lonMax
            + "&lat_min=" + latMin
            + "&lat_max=" + latMax
        );
        return proxyBinary(uri);
    }

    @GetMapping(value = "/api/ocean_meta", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StreamingResponseBody> getOceanMeta() throws IOException, InterruptedException {
        URI uri = URI.create(oceanApiBaseUrl + "/api/ocean_meta");

        HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
        HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());

        if (response.statusCode() >= 400) {
            try (InputStream errorStream = response.body()) {
                String errorBody = new String(errorStream.readAllBytes(), StandardCharsets.UTF_8);
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.TEXT_PLAIN)
                    .body(outputStream -> outputStream.write(errorBody.getBytes(StandardCharsets.UTF_8)));
            }
        }

        StreamingResponseBody streamingBody = outputStream -> streamResponse(response.body(), outputStream);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .body(streamingBody);
    }

    @GetMapping(value = "/api/coastline_3d", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> getCoastline3d() throws IOException, InterruptedException {
        URI uri = URI.create(oceanApiBaseUrl + "/api/coastline_3d");
        return proxyBinary(uri);
    }

    private ResponseEntity<StreamingResponseBody> proxyBinary(URI uri) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
        HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());

        if (response.statusCode() >= 400) {
            try (InputStream errorStream = response.body()) {
                String errorBody = new String(errorStream.readAllBytes(), StandardCharsets.UTF_8);
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.TEXT_PLAIN)
                    .body(outputStream -> outputStream.write(errorBody.getBytes(StandardCharsets.UTF_8)));
            }
        }

        StreamingResponseBody streamingBody = outputStream -> streamResponse(response.body(), outputStream);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_OCTET_STREAM_VALUE)
            .body(streamingBody);
    }

    private void streamResponse(InputStream inputStream, OutputStream outputStream) throws IOException {
        try (InputStream in = inputStream; OutputStream out = outputStream) {
            in.transferTo(out);
            out.flush();
        }
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<String> handleProxyError(Exception exception) {
        String detail = exception.getMessage();
        if (detail == null || detail.isBlank()) {
            detail = exception.toString();
        }
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
            .contentType(MediaType.TEXT_PLAIN)
            .body("Ocean API proxy error: " + detail);
    }
}
