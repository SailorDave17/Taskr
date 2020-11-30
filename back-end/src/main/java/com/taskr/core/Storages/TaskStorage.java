package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import org.springframework.stereotype.Service;

@Service
public class TaskStorage {

    private TaskRepository taskRepo;

    public TaskStorage(TaskRepository taskRepo) {
        this.taskRepo = taskRepo;
    }

    public void save(Task task) {
        taskRepo.save(task);
    }

    public void deleteById(Long id) {
        taskRepo.deleteById(id);
    }

    public Iterable<Task> findAll() {
        return taskRepo.findAll();
    }

    public Task findById(Long id) {
        if(taskRepo.findById(id).isPresent()) {
            return taskRepo.findById(id).get();
        } else return null;
    }

}
