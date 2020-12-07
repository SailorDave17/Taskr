package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class UserStorage {

    private UserRepository userRepo;
    private TaskTemplateRepository taskTemplateRepo;

    public UserStorage(UserRepository userRepo, TaskTemplateRepository taskTemplateRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
        this.userRepo = userRepo;
    }

//    public void updateAllUsers() {
//        for (User user : userRepo.findAll()) {
//            updateUser(user);
//        }
//    }

    public void save(User user) {
        this.userRepo.save(user);
        System.out.println("I committed changes to the user to the database");
    }

    public void deleteById(Long id) {
        userRepo.deleteById(id);
    }

    public void delete(User user) {
        userRepo.delete(user);
    }

    public Iterable<User> findAll() {
        return userRepo.findAll();
    }

    public User findById(Long id) {
        User dummyUser = new User("User not found");
        if (userRepo.findById(id).isPresent()) {
            return userRepo.findById(id).get();
        } else return dummyUser;
    }

    public User findUserByName(String name) {
        User dummyUser = new User("User not found");
        Optional<User> retrievedUserOptional = Optional.ofNullable(userRepo.findUserByName(name));
        if (retrievedUserOptional.isPresent()) {
            return retrievedUserOptional.get();
        } else return dummyUser;
    }

    public void updateUserNumberTasksAssigned(User user) {
        user.setNumberTasksAssigned(user.getTaskList().size());
        System.out.println("I set " + user.getName() + "'s number of tasks assigned to " + user.getTaskList().size());
        save(user);
    }

    public void updateUserNumberTasksCompleted(User user) {
        int numberTasksComplete = 0;
        for (Task task : user.getTaskList()) {
            if (task.isDone()) {
                numberTasksComplete +=1;
            }
        }
        user.setNumberTasksComplete(numberTasksComplete);
        save(user);
    }

    public void updateUserTimeCommitment(User user) {
        int committedTime = 0;
        for (Task task : user.getTaskList()) {
            committedTime += task.getActualWorkTime();
        }
        user.setRemainingAvailableTime(user.getTotalAvailableTime() - committedTime);
        save(user);
    }

    public void updateUser(User user){
        System.out.println("I ran the function updateUser");
        updateUserNumberTasksAssigned(user);
        updateUserNumberTasksCompleted(user);
        updateUserTimeCommitment(user);
    }
}
