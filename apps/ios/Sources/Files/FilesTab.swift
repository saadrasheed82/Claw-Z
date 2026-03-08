import Foundation
import Observation
import OpenClawKit
import SwiftUI

struct WorkspaceFile: Identifiable, Codable, Equatable {
    let id: UUID
    let name: String
    let path: String
    let isDirectory: Bool
    let size: Int?
    let updatedAtMs: Int?

    init(name: String, path: String, isDirectory: Bool, size: Int? = nil, updatedAtMs: Int? = nil) {
        self.id = UUID()
        self.name = name
        self.path = path
        self.isDirectory = isDirectory
        self.size = size
        self.updatedAtMs = updatedAtMs
    }
}

@MainActor
@Observable
class WorkspaceFilesModel {
    var files: [WorkspaceFile] = []
    var currentPath: String = ""
    var isLoading: Bool = false
    var errorText: String?
    var agentId: String = "main"

    private let gateway: GatewayNodeSession

    init(gateway: GatewayNodeSession) {
        self.gateway = gateway
    }

    var currentDirectory: String {
        if currentPath.isEmpty {
            return "/"
        }
        return currentPath
    }

    var parentPath: String? {
        guard !currentPath.isEmpty else { return nil }
        let components = currentPath.split(separator: "/")
        guard components.count > 1 else { return nil }
        return components.dropLast().joined(separator: "/")
    }

    func loadFiles() async {
        isLoading = true
        errorText = nil

        do {
            let params: [String: AnyCodable] = [
                "agentId": AnyCodable(agentId)
            ]
            let data = try await gateway.request(method: "workspace-files.list", params: params, timeoutMs: 15000)

            struct ListResponse: Codable {
                let files: [FileEntry]
                struct FileEntry: Codable {
                    let name: String
                    let path: String
                    let isDirectory: Bool
                    let size: Int?
                    let updatedAtMs: Int?
                }
            }

            let response = try JSONDecoder().decode(ListResponse.self, from: data)
            self.files = response.files.map { entry in
                WorkspaceFile(
                    name: entry.name,
                    path: entry.path,
                    isDirectory: entry.isDirectory,
                    size: entry.size,
                    updatedAtMs: entry.updatedAtMs
                )
            }
            self.currentPath = ""
        } catch {
            errorText = error.localizedDescription
        }

        isLoading = false
    }

    func navigateToFolder(_ folder: WorkspaceFile) async {
        guard folder.isDirectory else { return }
        currentPath = folder.path
        await loadFilesAtPath(folder.path)
    }

    func loadFilesAtPath(_ path: String) async {
        isLoading = true
        errorText = nil

        do {
            let params: [String: AnyCodable] = [
                "agentId": AnyCodable(agentId)
            ]
            let data = try await gateway.request(method: "workspace-files.list", params: params, timeoutMs: 15000)

            struct ListResponse: Codable {
                let files: [FileEntry]
                struct FileEntry: Codable {
                    let name: String
                    let path: String
                    let isDirectory: Bool
                    let size: Int?
                    let updatedAtMs: Int?
                }
            }

            let response = try JSONDecoder().decode(ListResponse.self, from: data)
            self.files = response.files.map { entry in
                WorkspaceFile(
                    name: entry.name,
                    path: entry.path,
                    isDirectory: entry.isDirectory,
                    size: entry.size,
                    updatedAtMs: entry.updatedAtMs
                )
            }
        } catch {
            errorText = error.localizedDescription
        }

        isLoading = false
    }

    func navigateUp() async {
        guard let parent = parentPath else { return }
        currentPath = parent
        await loadFilesAtPath(parent)
    }

    func createFile(name: String, isDirectory: Bool, content: String = "") async -> Bool {
        let fullPath = currentPath.isEmpty ? name : "\(currentPath)/\(name)"

        do {
            let params: [String: AnyCodable] = [
                "agentId": AnyCodable(agentId),
                "path": AnyCodable(fullPath),
                "isDirectory": AnyCodable(isDirectory),
                "content": AnyCodable(content)
            ]
            _ = try await gateway.request(method: "workspace-files.create", params: params, timeoutMs: 15000)
            await loadFilesAtPath(currentPath)
            return true
        } catch {
            errorText = error.localizedDescription
            return false
        }
    }

    func deleteFile(_ file: WorkspaceFile) async -> Bool {
        do {
            let params: [String: AnyCodable] = [
                "agentId": AnyCodable(agentId),
                "path": AnyCodable(file.path)
            ]
            _ = try await gateway.request(method: "workspace-files.delete", params: params, timeoutMs: 15000)
            await loadFilesAtPath(currentPath)
            return true
        } catch {
            errorText = error.localizedDescription
            return false
        }
    }
}

struct FilesTab: View {
    let gateway: GatewayNodeSession
    @State private var model: WorkspaceFilesModel?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let model = model {
                    FilesListView(model: model)
                } else {
                    ProgressView()
                        .onAppear {
                            let newModel = WorkspaceFilesModel(gateway: gateway)
                            Task {
                                await newModel.loadFiles()
                            }
                            model = newModel
                        }
                }
            }
            .navigationTitle("Files")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            model?.showCreateFileDialog = true
                        } label: {
                            Label("New File", systemImage: "doc")
                        }
                        Button {
                            model?.showCreateFolderDialog = true
                        } label: {
                            Label("New Folder", systemImage: "folder")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(item: $model?.fileToCreate) { file in
                CreateFileSheet(file: file) { name, content in
                    Task {
                        await model?.createFile(name: name, isDirectory: file.isDirectory, content: content)
                    }
                }
            }
        }
    }
}

extension WorkspaceFilesModel {
    var showCreateFileDialog: Bool {
        get { _showCreateFileDialog }
        set { 
            _showCreateFileDialog = newValue
            if newValue {
                fileToCreate = WorkspaceFile(name: "", path: "", isDirectory: false)
            }
        }
    }

    var showCreateFolderDialog: Bool {
        get { _showCreateFolderDialog }
        set {
            _showCreateFolderDialog = newValue
            if newValue {
                fileToCreate = WorkspaceFile(name: "", path: "", isDirectory: true)
            }
        }
    }

    private var _showCreateFileDialog: Bool = false
    private var _showCreateFolderDialog: Bool = false
    var fileToCreate: WorkspaceFile? {
        get { _fileToCreate }
        set { _fileToCreate = newValue }
    }
    private var _fileToCreate: WorkspaceFile?
}

struct FilesListView: View {
    @Bindable var model: WorkspaceFilesModel

    var body: some View {
        Group {
            if model.isLoading {
                ProgressView()
            } else if let error = model.errorText {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.red)
                    Text(error)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        Task {
                            await model.loadFiles()
                        }
                    }
                }
                .padding()
            } else {
                List {
                    if !model.currentPath.isEmpty {
                        Button {
                            Task {
                                await model.navigateUp()
                            }
                        } label: {
                            Label("Go Up", systemImage: "arrow.up")
                        }
                    }

                    ForEach(model.files) { file in
                        FileRow(file: file) {
                            Task {
                                await model.navigateToFolder(file)
                            }
                        }
                    }
                    .onDelete { indexSet in
                        Task {
                            for index in indexSet {
                                let file = model.files[index]
                                _ = await model.deleteFile(file)
                            }
                        }
                    }
                }
            }
        }
    }
}

struct FileRow: View {
    let file: WorkspaceFile
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Image(systemName: file.isDirectory ? "folder.fill" : "doc.fill")
                    .foregroundStyle(file.isDirectory ? .blue : .secondary)
                Text(file.name)
                Spacer()
                if let size = file.size {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct CreateFileSheet: View {
    let file: WorkspaceFile
    let onCreate: (String, String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var content: String = ""
    @State private var isCreating: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("file name", text: $name)
                }
                if !file.isDirectory {
                    Section("Content") {
                        TextEditor(text: $content)
                            .frame(minHeight: 200)
                    }
                }
            }
            .navigationTitle(file.isDirectory ? "New Folder" : "New File")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        isCreating = true
                        Task {
                            await onCreate(name, content)
                            dismiss()
                        }
                    }
                    .disabled(name.isEmpty || isCreating)
                }
            }
        }
    }
}
