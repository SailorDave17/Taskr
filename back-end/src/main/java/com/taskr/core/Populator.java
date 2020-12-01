package com.taskr.core;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class Populator implements CommandLineRunner {

    UserStorage userStorage;
    TaskTemplateStorage taskTemplateStorage;
    TaskStorage taskStorage;

    public Populator(UserStorage userStorage, TaskTemplateStorage taskTemplateStorage, TaskStorage taskStorage) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
    }

    @Override
    public void run(String... args) throws Exception {
        User testUser = new User("sample user");
        TaskTemplate testTemplate = new TaskTemplate("Sample task Template");
        taskTemplateStorage.save(testTemplate);
        userStorage.save(testUser);
        Task testTask = new Task(testUser, testTemplate);
        taskStorage.save(testTask);
    }
}
