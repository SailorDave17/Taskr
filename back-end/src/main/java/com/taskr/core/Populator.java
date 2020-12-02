package com.taskr.core;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import java.util.Date;
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
        TaskTemplate testTemplate = new TaskTemplate("Final Project Demo");
        taskTemplateStorage.save(testTemplate);
        userStorage.save(testUser);
        Task testTask = new Task(testUser, testTemplate);
        Date dueDate = new Date(1607576400000L);
        testTask.setDueBy(dueDate);
        testTask.setDescription(testTask.getDueBy().toString());
        taskStorage.save(testTask);
    }
}
