cmake_minimum_required(VERSION 3.25)
project(market_pos_core LANGUAGES C CXX VERSION 1.4.11)

# The WebAssembly demo build: the core reports refusals as exceptions, and
# Emscripten turns exception catching off unless asked.
if(EMSCRIPTEN)
  add_compile_options(-fexceptions)
  add_link_options(-fexceptions)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 11)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

if(MSVC)
  add_compile_options(/utf-8 /permissive- /Zc:__cplusplus /EHsc /MP)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN UNICODE _UNICODE _CRT_SECURE_NO_WARNINGS)
  set(MARKET_WARNING_FLAGS /W4 /wd4100)
else()
  add_compile_options(-Wno-unknown-pragmas)
  if(MINGW OR CMAKE_SYSTEM_NAME STREQUAL "Windows")
    add_link_options(-static -static-libgcc -static-libstdc++)
  endif()
  set(MARKET_WARNING_FLAGS -Wall -Wextra -Wno-unused-parameter)
endif()

set(TP ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
foreach(dep sqlite nlohmann spdlog catch2)
  if(NOT EXISTS ${TP}/${dep})
    message(FATAL_ERROR "Missing vendored dependency ${dep} under market-pos/native/third_party")
  endif()
endforeach()

add_library(tp_sqlite3 STATIC ${TP}/sqlite/sqlite3.c)
target_include_directories(tp_sqlite3 PUBLIC ${TP}/sqlite)
target_compile_definitions(tp_sqlite3 PUBLIC
  SQLITE_THREADSAFE=1 SQLITE_DQS=0 SQLITE_USE_URI=1 SQLITE_DEFAULT_MEMSTATUS=0
  SQLITE_DEFAULT_FOREIGN_KEYS=1 SQLITE_ENABLE_COLUMN_METADATA SQLITE_OMIT_DEPRECATED
  SQLITE_TRUSTED_SCHEMA=0
)

add_library(tp_json INTERFACE)
target_include_directories(tp_json INTERFACE ${TP}/nlohmann)

file(GLOB SPDLOG_SOURCES ${TP}/spdlog/src/*.cpp)
add_library(tp_spdlog STATIC ${SPDLOG_SOURCES})
target_include_directories(tp_spdlog PUBLIC ${TP}/spdlog/include)
target_compile_definitions(tp_spdlog PUBLIC SPDLOG_COMPILED_LIB)

file(GLOB_RECURSE CORE_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/core/src/*.cpp)
add_library(market_core_lib STATIC ${CORE_SOURCES})
target_include_directories(market_core_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/include)
target_link_libraries(market_core_lib PUBLIC tp_sqlite3 tp_json tp_spdlog)
target_compile_options(market_core_lib PRIVATE ${MARKET_WARNING_FLAGS})
target_compile_definitions(market_core_lib PUBLIC MARKET_CORE_VERSION="${PROJECT_VERSION}")
if(NOT EMSCRIPTEN)
  find_package(Threads REQUIRED)
  target_link_libraries(market_core_lib PUBLIC Threads::Threads)
endif()
if(WIN32)
  # bcrypt was already here; the rest are what the ported printing needs:
  # setupapi and winspool to enumerate printers, iphlpapi for the ARP cache,
  # ws2_32 for the subnet probe and for talking to a LAN printer on 9100.
  target_link_libraries(market_core_lib PUBLIC bcrypt setupapi winspool iphlpapi ws2_32)
endif()

add_executable(market_pos_core ${CMAKE_CURRENT_SOURCE_DIR}/sidecar/main.cpp)
set_target_properties(market_pos_core PROPERTIES OUTPUT_NAME market-pos-core)
target_link_libraries(market_pos_core PRIVATE market_core_lib)
if(WIN32)
  set_target_properties(market_pos_core PROPERTIES SUFFIX ".exe")
endif()

# The same core in WebAssembly for the possistem.az live demo (emcmake cmake).
if(EMSCRIPTEN)
  add_executable(market_core_wasm ${CMAKE_CURRENT_SOURCE_DIR}/wasm/demo_core.cpp)
  set_target_properties(market_core_wasm PROPERTIES OUTPUT_NAME market-pos-core SUFFIX ".mjs")
  target_link_libraries(market_core_wasm PRIVATE market_core_lib)
  target_link_options(market_core_wasm PRIVATE
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sSTACK_SIZE=2MB
    -sEXPORTED_FUNCTIONS=_market_boot,_market_call,_malloc,_free
    -sEXPORTED_RUNTIME_METHODS=ccall,FS,stringToUTF8,lengthBytesUTF8,UTF8ToString)
  return()
endif()

enable_testing()
file(GLOB_RECURSE TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp)
if(TEST_SOURCES)
  add_executable(market_core_tests
    ${TEST_SOURCES}
    ${TP}/catch2/catch_amalgamated.cpp
  )
  target_include_directories(market_core_tests PRIVATE ${TP}/catch2)
  target_link_libraries(market_core_tests PRIVATE market_core_lib)
  add_test(NAME market_core_tests COMMAND market_core_tests --reporter compact)
endif()

message(STATUS "market-pos-core ${PROJECT_VERSION} | ${CMAKE_BUILD_TYPE} | ${CMAKE_CXX_COMPILER_ID}")
